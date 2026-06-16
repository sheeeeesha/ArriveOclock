import { state } from './state.js';
import { getCurrentPosition, geolocationAvailable } from './geolocation.js';
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
// BATTERY: instead of a continuous high-accuracy watchPosition() stream, we
// take one-shot fixes and sleep between them. The sleep length is computed from
// how far you are from the alarm — minutes away when far, ~10 s when close —
// and high-accuracy GPS only switches on near the destination. GPS is idle
// between fixes; a cheap 1 s ticker animates the countdown in the meantime.
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
  const lead = state.leadTimeMin;
  const etaMin = displayEtaSec / 60;
  const alarmMin = Math.max(0, Math.round(etaMin - lead));
  el('countMin').textContent = alarmMin;
  el('liveMin').textContent = Math.max(0, Math.round(etaMin));
  el('liveKm').textContent = Math.max(0, L.leftKm).toFixed(1).replace(/\.0$/, '');
  el('liveSpeed').textContent = Math.max(0, Math.round(L.speedKmh || 0));
  el('liveEta').textContent = fmtClock(etaMin);

  const denom = Math.max(1, L.totalMin - lead);
  el('ringProg').style.strokeDashoffset = (RING_CIRC * (1 - alarmMin / denom)).toFixed(1);
  el('trackFill').style.width = Math.min(100, Math.max(3, (1 - etaMin / L.totalMin) * 100)) + '%';

  if (etaMin - lead <= 0 && !fired) fire();
}

function setGpsStatus(text) {
  if (el('liveGps')) el('liveGps').textContent = text;
}

function fire() {
  fired = true;
  clearTimeout(fixTimer);
  el('alarmDest').textContent = state.dest?.name || 'your stop';
  el('alarmRing').classList.add('show');
  if (state.vibrate && navigator.vibrate) navigator.vibrate([500, 250, 500, 250, 500]);
  playTone(state.tone);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Almost there', {
      body: `You arrive at ${state.dest?.name || 'your stop'} in about ${state.leadTimeMin} min.`,
    });
  }
  if (state.journeyId) updateJourney(state.journeyId, { alarm_fired: true });
}

export function begin() {
  fired = false;
  lastFix = null;
  const route = state.routes[state.mode] || {};
  routeCoords = route.coordinates || null;
  suffixLen = routeCoords ? buildSuffix(routeCoords) : null;

  const totalMin = Math.max(1, Math.round((route.duration_s || 1680) / 60));
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

  simulate = !geolocationAvailable() || (state.origin && state.origin.fallback);
  setGpsStatus(simulate ? 'Simulated trip (no live GPS)' : 'Live GPS · battery-saver');

  paint();
  startTicker();
  if (!simulate) scheduleFix(0);
}

function startTicker() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const L = state.live;
    if (!L || fired) return;
    if (simulate) {
      L.leftMin = Math.max(0, L.leftMin - 1); // ~1 travel-min per second
      L.leftKm = Math.max(0, L.totalKm * (L.leftMin / L.totalMin));
      L.speedKmh = 36 + Math.round(Math.abs(Math.sin(Date.now() / 2000)) * 16);
      displayEtaSec = L.leftMin * 60;
    } else if (speedMps > 0.4) {
      // Moving: smoothly tick the countdown down between GPS fixes.
      displayEtaSec = Math.max(0, displayEtaSec - 1);
    }
    paint();
  }, 1000);
}

function scheduleFix(delaySec) {
  clearTimeout(fixTimer);
  fixTimer = setTimeout(doFix, delaySec * 1000);
}

function nextDelaySec(etaMin, remainingM) {
  const lead = state.leadTimeMin;
  if (etaMin - lead <= 1) return 8;
  if (etaMin - lead <= 3) return 15;
  if (remainingM < 1500) return 12;
  // Otherwise check at ~40% of the time-to-alarm, clamped to [30s, 5min].
  return Math.min(300, Math.max(30, (etaMin - lead - 1) * 60 * 0.4));
}

async function doFix() {
  if (fired) return;
  const L = state.live;
  // Decide accuracy from the LAST known proximity (cheap when far).
  const highAcc = (L.leftKm != null && L.leftKm < 4) || (measuredEtaMin != null && measuredEtaMin < 6);
  const pos = await getCurrentPosition(highAcc);

  if (pos.fallback) {
    // Lost GPS — degrade to a simulated countdown so the alarm still fires.
    simulate = true;
    setGpsStatus('GPS unavailable · estimating');
    return;
  }

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

  if (speedMps > 0.4) {
    measuredEtaMin = remainingM / speedMps / 60;
    displayEtaSec = measuredEtaMin * 60; // resync the smooth ticker to truth
    L.totalMin = Math.max(L.totalMin, measuredEtaMin + state.leadTimeMin);
  }
  lastFix = { lng: pos.lng, lat: pos.lat, t: now };
  paint();

  if (measuredEtaMin - state.leadTimeMin <= 0) { fire(); return; }

  const delay = nextDelaySec(measuredEtaMin, remainingM);
  setGpsStatus(`Live GPS · next check in ${Math.round(delay)}s${highAcc ? ' · precise' : ' · low-power'}`);
  scheduleFix(delay);
}

export function end() {
  clearInterval(tickTimer);
  clearTimeout(fixTimer);
  stopTone();
  if (state.journeyId) updateJourney(state.journeyId, { status: 'cancelled', ended_at: new Date().toISOString() });
}

export function silence() {
  clearInterval(tickTimer);
  clearTimeout(fixTimer);
  stopTone();
  if (state.journeyId) updateJourney(state.journeyId, { status: 'completed', ended_at: new Date().toISOString() });
}
