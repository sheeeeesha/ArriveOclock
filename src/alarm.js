import { state, distFromKm, speedFromKmh } from './state.js';
import { getCurrentPosition, geolocationAvailable, watchPosition } from './geolocation.js';
import { isNative, platform, startBackgroundTracking, stopBackgroundTracking, fireNativeAlarm, cancelBackupAlarm } from './native.js';
import { updateUserLocation } from './map.js';
import { playTone, stopTone } from './sound.js';
import { updateJourney } from './db.js';
import { haversine } from './directions.js';

// ---------------------------------------------------------------------------
// The dynamic, MOTION-BASED alarm. The trigger time is derived continuously
// from your real movement — remaining distance (measured along the planned
// route) ÷ your rolling average speed — NOT from any routing API. That makes
// it:
//   • free + global + offline-capable (no network needed during the trip)
//   • mode-agnostic (a 60 km/h train and an 18 km/h bus are handled the same)
//
// BATTERY + ACCURACY (hybrid sampling):
//   • FAR  → spaced one-shot fixes; the gap scales with time-to-alarm (minutes
//     apart when far) and uses low-power location. GPS is idle between fixes;
//     a cheap 1 s ticker animates the countdown.
//   • NEAR → once the alarm is within reach (≈<2 km or ≤ lead+3 min) we switch
//     to a continuous high-accuracy watchPosition() so a STOP is detected
//     within a second or two and can't trigger a premature alarm. The trip's
//     final stretch is short, so the extra GPS use is brief.
// A stop holds the ETA (we only advance it while speed > 0.4 m/s); it never
// counts down to a false alarm while stationary.
// ---------------------------------------------------------------------------

const RING_CIRC = 2 * Math.PI * 24;

let tickTimer = null;
let fixTimer = null;
let lastFix = null; // { lng, lat, t }
let speedMps = 0;
let measuredEtaMin = null;
let displayEtaSec = 0;
let routeCoords = null;
let suffixLen = null; // cumulative metres from vertex i → end
let fired = false;
let simulate = false;
let watchStop = null; // active continuous-watch unsubscribe (near destination)
let watching = false;
let tripStartMs = 0;     // when the current journey began
let leadMin = 5;         // EFFECTIVE lead minutes (capped for short trips — see begin)
let hasDeparted = false; // true once we've seen the user OUTSIDE the arrival radius

// Firing is POSITION-based, never a wall-clock countdown: the alarm only fires
// from a real GPS fix that shows you're actually approaching / at the stop. So a
// stationary user (no fixes / huge ETA) never triggers it, and it can't ring at
// the start of a trip when you're still far away.
const START_GRACE_MS = 15000;  // hard floor: never ring within the first 15s
const ARRIVAL_RADIUS_M = 150;  // geofence — "physically at the stop"
const MOVING_MPS = 0.6;        // min speed (~2 km/h) to trust the ETA trigger

const el = (id) => document.getElementById(id);

function fmtClock(minFromNow) {
  const d = new Date(Date.now() + minFromNow * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Precompute cumulative distance from each vertex to the end of the route.
function buildSuffix(coords) {
  const n = coords.length;
  const s = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    const a = { lng: coords[i][0], lat: coords[i][1] };
    const b = { lng: coords[i + 1][0], lat: coords[i + 1][1] };
    s[i] = s[i + 1] + haversine(a, b);
  }
  return s;
}

// Remaining metres to destination, measured along the route from the nearest vertex.
function remainingAlongRoute(pos) {
  if (!routeCoords || routeCoords.length < 2) {
    return state.dest ? haversine(pos, state.dest) : 0;
  }
  let best = Infinity, bi = 0;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = haversine(pos, { lng: routeCoords[i][0], lat: routeCoords[i][1] });
    if (d < best) { best = d; bi = i; }
  }
  return best + suffixLen[bi];
}

function paint() {
  const L = state.live;
  if (!L) return;
  const lead = leadMin;
  const etaMin = displayEtaSec / 60;
  const alarmMin = Math.max(0, Math.round(etaMin - lead));
  el('countMin').textContent = alarmMin;
  el('liveMin').textContent = Math.max(0, Math.round(etaMin));
  el('liveKm').textContent = Math.max(0, distFromKm(L.leftKm)).toFixed(1).replace(/\.0$/, '');
  el('liveSpeed').textContent = Math.max(0, Math.round(speedFromKmh(L.speedKmh || 0)));
  el('liveEta').textContent = fmtClock(etaMin);

  const denom = Math.max(1, L.totalMin - lead);
  el('ringProg').style.strokeDashoffset = (RING_CIRC * (1 - alarmMin / denom)).toFixed(1);
  el('trackFill').style.width = Math.min(100, Math.max(3, (1 - etaMin / L.totalMin) * 100)) + '%';
  // NOTE: paint() never fires the alarm — that would be a wall-clock countdown.
  // Firing is decided in processFix() (real position) or the simulate ticker.
}

function setGpsStatus(text) {
  if (el('liveGps')) el('liveGps').textContent = text;
}

function fire() {
  if (fired) return;
  // Suppress any alarm in the opening seconds of a trip — paint()/processFix will
  // call fire() again once the grace window passes, so a genuinely-near stop still
  // rings, just not the instant you tap start.
  if (Date.now() - tripStartMs < START_GRACE_MS) return;
  fired = true;
  clearTimeout(fixTimer);
  stopWatch();
  el('alarmDest').textContent = state.dest?.name || 'your stop';
  el('alarmRing').classList.add('show');
  const body = `You're arriving at ${state.dest?.name || 'your stop'}.`;
  if (isNative) {
    // Ring the native full-screen alarm NOW (alarm stream, over the lock screen).
    // This is reached from a real GPS fix, so on a locked phone the background
    // foreground-service fix wakes the JS, which fires this. There is no pending
    // scheduled alarm to also fire, so it rings exactly once.
    fireNativeAlarm('Almost there', body);
  } else {
    if (state.vibrate && navigator.vibrate) navigator.vibrate([500, 250, 500, 250, 500]);
    playTone(state.tone);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Almost there', { body });
    }
  }
  if (state.journeyId) updateJourney(state.journeyId, { alarm_fired: true });
}

export function begin() {
  stopWatch(); // clear any leftover watch from a prior journey
  fired = false;
  lastFix = null;
  hasDeparted = false;
  lastRemainingM = null;
  tripStartMs = Date.now();
  const route = state.routes[state.mode] || {};
  routeCoords = route.coordinates || null;
  suffixLen = routeCoords ? buildSuffix(routeCoords) : null;

  const totalMin = Math.max(1, Math.round((route.duration_s || 1680) / 60));
  // Effective lead time: cap to 60% of the trip so a short trip never rings at
  // the start. A 5-min trip with a 5-min lead would otherwise have ETA <= lead
  // from the very beginning and fire immediately; capping makes it ring ~40% in.
  leadMin = Math.min(state.leadTimeMin, Math.max(0.5, totalMin * 0.6));
  const totalKm = +(((route.distance_m || 21000) / 1000).toFixed(1));
  state.live = { totalMin, totalKm, leftMin: totalMin, leftKm: totalKm, speedKmh: Math.round((totalKm / totalMin) * 60) };
  state.routeSummary = route.summary || '';
  displayEtaSec = totalMin * 60;
  measuredEtaMin = totalMin;
  speedMps = (totalKm * 1000) / (totalMin * 60); // planned avg speed until first fix

  if (el('liveVia')) el('liveVia').textContent = state.routeSummary || 'On your way';

  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch { /* legacy */ }
  }

  if (isNative) {
    // Native: continuous background tracking keeps the engine alive with the
    // screen off; each fix feeds the same processFix().
    simulate = false;
    setGpsStatus(`Background tracking · ${platform}`);
    startBackgroundTracking((loc) => processFix(loc));
  } else {
    simulate = !geolocationAvailable() || (state.origin && state.origin.fallback);
    setGpsStatus(simulate ? `Simulated · ${platform}` : `Foreground only · ${platform}`);
    if (!simulate) scheduleFix(0);
  }

  paint();
  startTicker();
}

function startTicker() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const L = state.live;
    if (!L || fired) return;
    if (simulate) {
      // No real GPS: simulate the journey and fire on the simulated countdown.
      L.leftMin = Math.max(0, L.leftMin - 1); // ~1 travel-min per second
      L.leftKm = Math.max(0, L.totalKm * (L.leftMin / L.totalMin));
      L.speedKmh = 36 + Math.round(Math.abs(Math.sin(Date.now() / 2000)) * 16);
      displayEtaSec = L.leftMin * 60;
      paint();
      if (displayEtaSec / 60 - leadMin <= 0) fire();
    } else if (speedMps > 0.4) {
      // Live GPS: only animate the displayed countdown between fixes. Firing is
      // NOT driven from here — it would ring on wall-clock time even if the user
      // never moved. The real decision lives in processFix() (position-based).
      displayEtaSec = Math.max(0, displayEtaSec - 1);
      paint();
    }
  }, 1000);
}

function scheduleFix(delaySec) {
  clearTimeout(fixTimer);
  fixTimer = setTimeout(doFix, delaySec * 1000);
}

function nextDelaySec(etaMin, remainingM) {
  const lead = leadMin;
  if (etaMin - lead <= 1) return 8;
  if (etaMin - lead <= 3) return 15;
  if (remainingM < 1500) return 12;
  // Otherwise check at ~40% of the time-to-alarm, clamped to [30s, 5min].
  return Math.min(300, Math.max(30, (etaMin - lead - 1) * 60 * 0.4));
}

// We're "near" once the alarm is within reach — exactly the window where a
// stop could otherwise cause a premature alarm, so we track continuously there.
function isNear() {
  const L = state.live;
  return (
    (L && L.leftKm != null && L.leftKm < 2) ||
    (measuredEtaMin != null && measuredEtaMin <= leadMin + 3)
  );
}

// Apply one position update (shared by the one-shot fixes and the watch).
function processFix(pos) {
  if (fired) return;
  if (!pos || pos.fallback) {
    // Lost GPS — degrade to a simulated countdown so the alarm still fires.
    simulate = true;
    stopWatch();
    setGpsStatus('GPS unavailable · estimating');
    return;
  }
  const L = state.live;
  updateUserLocation('activeMap', pos.lng, pos.lat);
  const now = pos.ts || Date.now();

  // Rolling speed: prefer device speed, else derive from displacement.
  let inst;
  if (pos.speed != null && pos.speed >= 0.3) inst = pos.speed;
  else if (lastFix) {
    const dt = Math.max(1, (now - lastFix.t) / 1000);
    inst = haversine(lastFix, pos) / dt;
  } else inst = speedMps;
  speedMps = Math.max(0, 0.5 * speedMps + 0.5 * inst);

  const remainingM = remainingAlongRoute(pos);
  L.leftKm = remainingM / 1000;
  L.speedKmh = speedMps * 3.6;

  // Only advance the measured ETA while genuinely moving — a stop holds it
  // (so it never counts down to a false alarm while stationary).
  if (speedMps > 0.4) {
    measuredEtaMin = remainingM / speedMps / 60;
    displayEtaSec = measuredEtaMin * 60; // resync the smooth ticker to truth
    L.totalMin = Math.max(L.totalMin, measuredEtaMin + leadMin);
  }
  lastFix = { lng: pos.lng, lat: pos.lat, t: now };
  paint();

  // ---- POSITION-BASED fire decision (never a wall-clock countdown) ----
  // Direct distance to the stop drives the geofence; along-route remaining ÷
  // speed drives the lead-time ETA. A stationary or far-away user satisfies
  // neither, so the alarm can't ring at the start or while waiting in place.
  const haveDest = state.dest && state.dest.lng != null;
  const directM = haveDest ? haversine(pos, { lng: state.dest.lng, lat: state.dest.lat }) : Infinity;
  if (directM > ARRIVAL_RADIUS_M) hasDeparted = true;
  const approaching = speedMps > MOVING_MPS && measuredEtaMin != null && measuredEtaMin <= leadMin;
  const arrived = hasDeparted && directM <= ARRIVAL_RADIUS_M;
  if (haveDest && (approaching || arrived)) fire();
}

// Spaced one-shot fix (battery-friendly), used while far from the destination.
async function doFix() {
  if (fired || watching) return;
  const L = state.live;
  const highAcc = (L.leftKm != null && L.leftKm < 4) || (measuredEtaMin != null && measuredEtaMin < 6);
  const pos = await getCurrentPosition(highAcc);
  processFix(pos);
  if (fired || simulate) return;

  // Near the destination → switch to continuous tracking so a stop is caught
  // within a second or two (no premature alarm). Otherwise schedule the next
  // spaced fix.
  if (isNear()) { startWatch(); return; }
  const delay = nextDelaySec(measuredEtaMin, (L.leftKm || 0) * 1000);
  setGpsStatus(`Live GPS · next check in ${Math.round(delay)}s${highAcc ? ' · precise' : ' · low-power'}`);
  scheduleFix(delay);
}

function startWatch() {
  if (watching || fired || simulate) return;
  watching = true;
  clearTimeout(fixTimer);
  setGpsStatus('Live GPS · continuous (approaching stop)');
  watchStop = watchPosition((pos) => {
    if (fired) return;
    processFix(pos);
    // If we somehow moved far again, drop back to battery-saving spaced fixes.
    if (!fired && !simulate && watching && !isNear()) {
      stopWatch();
      scheduleFix(nextDelaySec(measuredEtaMin, (state.live.leftKm || 0) * 1000));
    }
  }, true);
}

function stopWatch() {
  if (watchStop) watchStop();
  watchStop = null;
  watching = false;
}

export function end() {
  clearInterval(tickTimer);
  clearTimeout(fixTimer);
  stopWatch();
  stopBackgroundTracking();
  cancelBackupAlarm();
  stopTone();
  if (state.journeyId) updateJourney(state.journeyId, { status: 'cancelled', ended_at: new Date().toISOString() });
}

export function silence() {
  clearInterval(tickTimer);
  clearTimeout(fixTimer);
  stopWatch();
  stopBackgroundTracking();
  cancelBackupAlarm();
  stopTone();
  if (state.journeyId) updateJourney(state.journeyId, { status: 'completed', ended_at: new Date().toISOString() });
}
