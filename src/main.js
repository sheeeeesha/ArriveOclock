import './styles.css';
import { DEMO, logConfig } from './config.js';
import { state, TONES, distUnit, distVal, speedUnit } from './state.js';
import * as auth from './auth.js';
import * as db from './db.js';
import { searchPlacesDebounced, reverseGeocode } from './geocode.js';
import { getAllModes, getRoute } from './directions.js';
import { getCurrentPosition } from './geolocation.js';
import * as mapView from './map.js';
import * as alarm from './alarm.js';
import { chirp, previewTone, previewRingtone, stopRingtone, FADE_SEC } from './sound.js';
import {
  isNative, openAppSettings, onHardwareBack, exitApp,
  permissionStatus, openSetting, requestBasePermissions,
} from './native.js';
import {
  getRingtone, clearRingtone, pickLocalAudio, useLocalFile,
  searchFreeMusic, useFreeTrack,
} from './ringtone.js';

const el = (id) => document.getElementById(id);
// Escape text before inserting via innerHTML — names/addresses come from
// OpenStreetMap (third party) and user input, so they must not be trusted.
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// ===========================================================================
// Router
// ===========================================================================
function go(id, fromTab) {
  const cur = document.querySelector('.view.active');
  if (cur && cur.id !== id && !fromTab) state.navStack.push(cur.id);
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  el(id)?.classList.add('active');
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.go === id || (id === 'route' && t.dataset.go === 'search'))
  );
  const immersive = id === 'route' || id === 'active' || id === 'login' || id === 'onboarding';
  el('tabbar').style.display = immersive ? 'none' : 'flex';

  if (id === 'home') {
    mapView.showOverview('homeMap', state.origin && !state.origin.fallback ? state.origin : null);
    // If we already know the user's real position, drop the marker instantly.
    if (state.origin && !state.origin.fallback) mapView.setUserMarker('homeMap', state.origin.lng, state.origin.lat, false, state.origin.accuracy);
  }
  if (id === 'search') setTimeout(() => el('searchInput')?.focus(), 80);
  if (id === 'settings') { syncSettingsUI(); refreshPermissions({ render: false }); }
  if (id === 'permissions') refreshPermissions();
  if (id === 'profile') { renderStats(); renderProfile(); }
  window.scrollTo(0, 0);
}

// Fetch the user's location, show it on the home map, and cache it as origin.
async function locateOnHome(center = true) {
  const pos = await getCurrentPosition(true);
  if (pos.fallback) { toast('Enable location to see your position'); return; }
  state.origin = {
    name: 'Your location',
    address: state.origin && !state.origin.fallback ? state.origin.address : 'Current position',
    lng: pos.lng, lat: pos.lat, accuracy: pos.accuracy, fallback: false,
  };
  mapView.setUserMarker('homeMap', pos.lng, pos.lat, center, pos.accuracy);
  reverseGeocode(pos.lng, pos.lat).then((name) => { if (name) state.origin.address = name; });
}
function tabGo(id) {
  if (id === 'active' && !state.journeyActive) {
    toast('No active journey — set an alarm first');
    openSearch();
    return;
  }
  if (id === 'search') { openSearch(); return; }
  state.navStack = [];
  go(id, true);
}
function goBack() {
  go(state.navStack.pop() || 'home', true);
}

// ===========================================================================
// Hardware / gesture back.
//
// Android's back button previously closed the app from every screen. The rules
// below mirror what the on-screen back affordance does, with two deliberate
// exceptions: a ringing alarm ignores back entirely (you must not silence your
// stop by reflex), and leaving the journey screen does NOT end the trip —
// tracking continues, matching the fact that the alarm works in the background.
// ===========================================================================
let lastBackAt = 0;

function handleHardwareBack() {
  // 1. Alarm is ringing — back must never dismiss it.
  if (el('alarmRing')?.classList.contains('show')) return;

  // 2. A modal sheet takes back before the view does.
  if (!el('sheetScrim')?.hidden) { closeSheet(false); return; }

  const view = document.querySelector('.view.active')?.id;

  // 3. Transient panels close before the view does.
  const browse = el('ringtoneBrowse');
  if (view === 'sound' && browse && browse.style.display !== 'none') {
    browse.style.display = 'none';
    return;
  }
  const results = el('searchResults');
  if (view === 'search' && results && results.style.display !== 'none' && results.innerHTML) {
    resetSearchInput();
    return;
  }

  // 4. Per-screen navigation.
  if (view === 'search') { searchBack(); return; }
  if (view === 'active') {
    // The journey keeps running; say so, because leaving looks like cancelling.
    go('home', true);
    toast('Still tracking — the alarm will ring');
    return;
  }
  if (view === 'onboarding' || view === 'login') { confirmExit(); return; }
  if (state.navStack.length) { goBack(); return; }
  if (view && view !== 'home') { go('home', true); return; }

  // 5. Already home — require a second press so back never exits by accident.
  confirmExit();
}

function confirmExit() {
  const now = Date.now();
  if (now - lastBackAt < 2000) { exitApp(); return; }
  lastBackAt = now;
  toast('Press back again to exit');
}

// ===========================================================================
// Rendering
// ===========================================================================
function renderRecents() {
  const wrap = el('recentList');
  if (!wrap) return;
  if (!state.recents.length) {
    wrap.innerHTML =
      '<div class="empty"><svg><use href="#i-clock"/></svg><h3>No recent trips</h3><p>Places you search will show up here.</p></div>';
    return;
  }
  wrap.innerHTML = state.recents
    .map(
      (r) => `
    <div class="recent-item" data-pick="recent:${r.id}">
      <div class="r-ic"><svg><use href="#i-clock"/></svg></div>
      <div class="r-body"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.address)}</div></div>
      <div class="r-meta"><svg style="width:16px;height:16px"><use href="#i-go"/></svg></div>
    </div>`
    )
    .join('');
}
function renderSaved() {
  const wrap = el('savedList');
  if (!wrap) return;
  if (!state.saved.length) {
    wrap.innerHTML = '<div class="empty"><svg><use href="#i-bookmark"/></svg><h3>No saved places</h3><p>Add Home, Work or anywhere you go often.</p></div>';
    return;
  }
  // Body taps the place to use it; the pencil opens the editor.
  wrap.innerHTML = state.saved
    .map(
      (p) => `
    <div class="s-row">
      <div class="s-ic" data-pick="saved:${p.id}"><svg><use href="#${esc(p.icon || 'i-pin')}"/></svg></div>
      <div class="s-body" data-pick="saved:${p.id}"><div class="t">${esc(p.name)}</div><div class="d">${esc(p.address)}</div></div>
      <button class="row-edit" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}"><svg><use href="#i-edit"/></svg></button>
    </div>`
    )
    .join('');
}
function renderTones() {
  const wrap = el('toneList');
  if (!wrap) return;
  // A chosen song overrides the tones, so nothing here is ticked while one is set.
  const songActive = Boolean(getRingtone());
  wrap.innerHTML = TONES.map(
    (t) => `
    <div class="s-row" data-tone="${t}">
      <div class="s-ic"><svg><use href="#i-music"/></svg></div>
      <div class="s-body"><div class="t">${t}</div></div>
      <svg class="chev" style="opacity:${!songActive && t === state.tone ? 1 : 0}" data-check><use href="#i-go"/></svg>
    </div>`
  ).join('');
}
function renderProfile() {
  const initial = (state.user?.name || 'Y').trim().charAt(0).toUpperCase();
  document.querySelectorAll('[data-avatar]').forEach((a) => {
    if (state.user?.avatar) {
      // Quote + strip quotes/parens from the URL so it can't break out of url().
      const safe = String(state.user.avatar).replace(/["')\\]/g, '');
      a.style.backgroundImage = `url("${safe}")`;
      a.style.backgroundSize = 'cover';
      // Google's default avatars are coloured — force grayscale to stay on-brand.
      a.style.filter = 'grayscale(1)';
      a.textContent = '';
    } else {
      a.style.backgroundImage = '';
      a.style.filter = '';
      a.textContent = initial;
    }
  });
  if (el('profileName')) el('profileName').textContent = state.user?.name || 'You';
  if (el('profileEmail')) el('profileEmail').textContent = state.user?.email || '';

  // Once the user has rated, swap the "Rate" row for a "Share" action.
  const rateRow = el('rateRow');
  if (rateRow) {
    let rated = null;
    try { rated = localStorage.getItem('aoc_rated'); } catch { /* private mode */ }
    if (rated) {
      const stars = '★'.repeat(Math.max(1, Math.min(5, +rated)));
      rateRow.dataset.act = 'shareApp';
      rateRow.innerHTML = `<div class="s-ic"><svg><use href="#i-nav"/></svg></div><div class="s-body"><div class="t">Share ArriveO'Clock</div><div class="d">Thanks for rating ${stars}</div></div><svg class="chev"><use href="#i-chevron"/></svg>`;
    } else {
      rateRow.dataset.act = 'go:review';
      rateRow.innerHTML = `<div class="s-ic"><svg><use href="#i-star"/></svg></div><div class="s-body"><div class="t">Rate ArriveO'Clock</div></div><svg class="chev"><use href="#i-chevron"/></svg>`;
    }
  }
}

// Real trip stats from the journey history.
async function renderStats() {
  const s = await db.getJourneyStats();
  if (el('statTrips')) el('statTrips').textContent = s.trips;
  if (el('statMissed')) el('statMissed').textContent = s.missed;
  if (el('statHours')) el('statHours').textContent = (Number.isInteger(s.hours) ? s.hours : s.hours.toFixed(1)) + 'h';
}

// Reflect the current alarm lead time across the settings control + all hints.
function renderLead() {
  const n = state.leadTimeMin;
  document.querySelectorAll('#leadSeg button').forEach((b) => b.classList.toggle('active', +b.dataset.lead === n));
  const txt = `${n} min`;
  if (el('leadHintRoute')) el('leadHintRoute').textContent = txt;
  if (el('leadHintBanner')) el('leadHintBanner').textContent = txt;
}
function setLeadTime(n) {
  state.leadTimeMin = n;
  db.updateProfile({ lead_time_min: n });
  renderLead();
  toast(`Alarm will ring ${n} min before arrival`);
}

// Reflect the distance/speed unit across the settings control + live labels,
// and re-render the route stats if they're showing.
function renderUnits() {
  document.querySelectorAll('#unitSeg button').forEach((b) => b.classList.toggle('active', b.dataset.unit === state.units));
  if (el('liveKmLabel')) el('liveKmLabel').textContent = distUnit() + ' left';
  if (el('liveSpeedLabel')) el('liveSpeedLabel').textContent = speedUnit();
  // Re-render the route stat in the new unit if one is already computed (the
  // route DOM persists across screens, so this also covers settings → route).
  if (state.routes[state.mode] && el('statKm') && el('statKm').textContent !== '—') applyMode(state.mode);
}
function setUnits(u) {
  state.units = u;
  db.updateProfile({ units: u });
  renderUnits();
}

// ===========================================================================
// Place selection → route flow
// ===========================================================================
async function ensureOrigin() {
  // Reuse a real fix, but never cache a fallback — retry GPS so a user who
  // wasn't located on the first try (or denied, then allowed) gets correct ETAs.
  if (state.origin && state.origin.lng != null && !state.origin.fallback) return;
  const pos = await getCurrentPosition();
  state.origin = {
    name: 'Your location',
    address: pos.fallback ? 'Default area' : 'Current position',
    lng: pos.lng,
    lat: pos.lat,
    fallback: pos.fallback,
  };
  // Reverse-geocode a friendly label (best effort, doesn't block).
  if (!pos.fallback) {
    reverseGeocode(pos.lng, pos.lat).then((name) => {
      if (name) {
        state.origin.address = name;
        if (el('routeOrigin')) el('routeOrigin').textContent = 'Your location · ' + name;
      }
    });
  }
}

// Open the search screen as a normal destination search.
function openSearch() {
  state.pickTarget = null;
  state.pickReturn = null;
  if (el('searchTitle')) el('searchTitle').textContent = 'Set destination';
  resetSearchInput();
  go('search');
}

// Open the search screen as a picker for a specific field, remembering where
// to return so the round trip doesn't pollute the back stack.
function openPicker(target) {
  state.pickTarget = target;
  state.pickReturn = document.querySelector('.view.active')?.id || 'home';
  const titles = { origin: 'Set start point', dest: 'Set destination', editLocation: 'Set location' };
  if (el('searchTitle')) el('searchTitle').textContent = titles[target] || 'Search';
  resetSearchInput();
  go('search', true);
}

// Back button on the search screen: cancel a picker cleanly, else normal back.
function searchBack() {
  if (state.pickReturn) {
    const r = state.pickReturn;
    state.pickReturn = null;
    state.pickTarget = null;
    go(r, true);
  } else {
    goBack();
  }
}

function resetSearchInput() {
  if (el('searchInput')) el('searchInput').value = '';
  const r = el('searchResults');
  if (r) { r.innerHTML = ''; r.style.display = 'none'; }
}

// Single entry point for every place selection (search result, recent, saved,
// chip). Routes the choice to whatever the search screen was opened for.
async function choosePlace(place) {
  const target = state.pickTarget;
  const back = state.pickReturn;
  state.pickTarget = null;
  state.pickReturn = null;

  if (target === 'origin') {
    state.origin = { name: place.name || 'Start', address: place.address || '', lng: place.lng, lat: place.lat, fallback: false };
    if (el('routeOrigin')) el('routeOrigin').textContent = state.origin.name;
    go('route', true);
    recomputeRoute();
    return;
  }
  if (target === 'dest') {
    setDest(place);
    db.addRecent(place).then(renderRecents);
    go('route', true);
    recomputeRoute();
    return;
  }
  if (target === 'editLocation') {
    state.editing.lng = place.lng;
    state.editing.lat = place.lat;
    state.editing.address = place.address || place.name;
    if (!state.editing.name) state.editing.name = place.name;
    populateEditPlace();
    go(back || 'editPlace', true);
    return;
  }
  // Normal: choose a destination and go to the route screen.
  pickDest(place);
}

function setDest(place) {
  state.dest = place;
  ['routeDest', 'liveDest'].forEach((id) => { if (el(id)) el(id).textContent = place.name; });
}

async function pickDest(place) {
  setDest(place);
  if (el('routeOrigin')) el('routeOrigin').textContent = state.origin?.name || 'Your location';
  await db.addRecent(place);
  renderRecents();
  await openRoute();
}

// Navigate to the route screen and (re)compute, resolving the user's location.
async function openRoute() {
  go('route');
  resetRouteStats();
  await ensureOrigin();
  if (el('routeOrigin')) el('routeOrigin').textContent = 'Your location' + (state.origin.address ? ' · ' + state.origin.address : '');
  recomputeRoute();
}

// Recompute routes for the current origin/dest (used after changing either).
async function recomputeRoute() {
  if (!state.origin || !state.dest) return;
  resetRouteStats();
  state.routes = await getAllModes(state.origin, state.dest);
  if (document.querySelector('.view.active')?.id !== 'route') return;
  renderModeEtas();
  applyMode(state.mode);
  const r = state.routes[state.mode];
  if (r) mapView.showRoute('routeMap', state.origin, state.dest, r.coordinates, { live: false, draggable: true, onDrag: handlePinDrag });
}

function resetRouteStats() {
  document.querySelectorAll('#modeRow .mode .m-eta').forEach((n) => (n.textContent = '…'));
  el('statTime').innerHTML = '—';
  el('statKm').innerHTML = '—';
  el('statEta').textContent = '—';
}

function renderModeEtas() {
  document.querySelectorAll('#modeRow .mode').forEach((btn) => {
    const r = state.routes[btn.dataset.mode];
    if (!r) return;
    const min = Math.max(1, Math.round(r.duration_s / 60));
    btn.dataset.min = min;
    btn.dataset.km = (r.distance_m / 1000).toFixed(1);
    btn.querySelector('.m-eta').textContent = min + 'm';
  });
}

function applyMode(modeKey) {
  state.mode = modeKey;
  document.querySelectorAll('#modeRow .mode').forEach((m) => m.classList.toggle('active', m.dataset.mode === modeKey));
  const r = state.routes[modeKey];
  if (!r) return;
  const min = Math.max(1, Math.round(r.duration_s / 60));
  const dist = distVal(r.distance_m).toFixed(1).replace(/\.0$/, '');
  el('statTime').innerHTML = `${min}<span style="font-size:.5em;font-weight:600"> min</span>`;
  el('statKm').innerHTML = `${dist}<span style="font-size:.5em;font-weight:600"> ${distUnit()}</span>`;
  el('statEta').textContent = clockFromNow(min);
  state.routeSummary = r.summary || '';
  mapView.showRoute('routeMap', state.origin, state.dest, r.coordinates, { live: false, draggable: true, onDrag: handlePinDrag });
}

function setMode(btn) {
  applyMode(btn.dataset.mode);
}

function clockFromNow(min) {
  const d = new Date(Date.now() + min * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Dragging a map pin sets that endpoint precisely, then re-routes.
function handlePinDrag(which, lngLat) {
  const p = { lng: lngLat.lng, lat: lngLat.lat };
  if (which === 'origin') {
    state.origin = { name: 'Your start', address: '', lng: p.lng, lat: p.lat, fallback: false };
    if (el('routeOrigin')) el('routeOrigin').textContent = 'Dropped start pin';
  } else {
    state.dest = { name: state.dest?.name || 'Destination', address: '', lng: p.lng, lat: p.lat };
    if (el('routeDest')) el('routeDest').textContent = 'Dropped pin';
  }
  // Reverse-geocode a friendly label (best effort).
  reverseGeocode(p.lng, p.lat).then((name) => {
    if (!name) return;
    if (which === 'origin') { state.origin.address = name; if (el('routeOrigin')) el('routeOrigin').textContent = 'Your start · ' + name; }
    else { state.dest.name = name; if (el('routeDest')) el('routeDest').textContent = name; }
  });
  recomputeRoute();
}

function swapRoute() {
  if (!state.dest || !state.origin) return;
  const o = state.origin, d = state.dest;
  state.origin = { name: d.name, address: d.address, lng: d.lng, lat: d.lat, fallback: false };
  state.dest = { name: o.name, address: o.address, lng: o.lng, lat: o.lat };
  if (el('routeDest')) el('routeDest').textContent = state.dest.name;
  if (el('routeOrigin')) el('routeOrigin').textContent = state.origin.name;
  recomputeRoute();
}

// ===========================================================================
// Saved-place editor (add / edit / delete)
// ===========================================================================
const EDIT_ICONS = ['i-home', 'i-work', 'i-pin', 'i-bookmark', 'i-bolt', 'i-star', 'i-clock'];

function openEditPlace(place) {
  state.editing = place
    ? { id: place.id, name: place.name, address: place.address, lng: place.lng, lat: place.lat, icon: place.icon || 'i-pin', kind: place.kind || 'other' }
    : { id: null, name: '', address: '', lng: null, lat: null, icon: 'i-pin', kind: 'other' };
  if (el('editTitle')) el('editTitle').textContent = place ? 'Edit place' : 'Add place';
  if (el('editDeleteBtn')) el('editDeleteBtn').style.display = place ? 'flex' : 'none';
  populateEditPlace();
  renderEditIcons();
  go('editPlace');
}

function populateEditPlace() {
  const e = state.editing || {};
  if (el('editLabel')) el('editLabel').value = e.name || '';
  if (el('editLocName')) el('editLocName').textContent = e.lng != null ? (e.address || e.name || 'Location set') : 'Tap to set location';
  if (el('editLocAddr')) el('editLocAddr').textContent = e.lng != null ? `${(+e.lat).toFixed(4)}, ${(+e.lng).toFixed(4)}` : '';
}

function renderEditIcons() {
  const row = el('editIconRow');
  if (!row) return;
  row.innerHTML = EDIT_ICONS.map(
    (ic) => `<button class="icon-opt ${ic === state.editing.icon ? 'sel' : ''}" data-icon="${ic}"><svg><use href="#${ic}"/></svg></button>`
  ).join('');
}

async function saveEditPlace() {
  const e = state.editing;
  const label = (el('editLabel')?.value || '').trim();
  if (!label) { toast('Give this place a name'); return; }
  if (e.lng == null) { toast('Set a location first'); return; }
  const place = { name: label, address: e.address || '', lng: e.lng, lat: e.lat, icon: e.icon, kind: e.kind };
  if (e.id) await db.updateSavedPlace(e.id, place);
  else await db.addSavedPlace(place);
  await db.getSavedPlaces();
  renderSaved();
  toast(e.id ? 'Place updated' : 'Place saved');
  goBack();
}

async function deleteEditPlace() {
  if (!state.editing?.id) { goBack(); return; }
  await db.deleteSavedPlace(state.editing.id);
  await db.getSavedPlaces();
  renderSaved();
  toast('Place deleted');
  goBack();
}

// ===========================================================================
// Journey lifecycle
// ===========================================================================
// Screen Wake Lock — keep the screen awake during a journey so the engine
// keeps running while the app is open (web apps can't run in the background).
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* noop */ }
  wakeLock = null;
}
// The lock drops when the tab is hidden; re-acquire on return if still travelling.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.journeyActive && !wakeLock) requestWakeLock();
});

async function startJourney() {
  let r = state.routes[state.mode];
  // Never arm on placeholder values: if the route wasn't computed (or has no
  // duration), compute it now so begin() gets real distance/duration/geometry
  // instead of the 28 min / 21 km fallback.
  if (!r || !(r.duration_s > 0) || !r.coordinates) {
    await ensureOrigin();
    try {
      const fresh = await getRoute(state.origin, state.dest, state.mode);
      if (fresh) { state.routes[state.mode] = fresh; r = fresh; }
    } catch { /* begin() still falls back gracefully */ }
  }
  state.journeyActive = true;
  if (el('ongoingBadge')) el('ongoingBadge').style.display = 'inline-block';
  if (el('liveDest')) el('liveDest').textContent = state.dest?.name || '';
  if (el('liveTone')) el('liveTone').textContent = soundLabel();
  chirp();
  state.journeyId = await db.createJourney({
    originLabel: state.origin?.name,
    originLng: state.origin?.lng,
    originLat: state.origin?.lat,
    destLabel: state.dest?.name,
    destLng: state.dest?.lng,
    destLat: state.dest?.lat,
    mode: state.mode,
    distanceM: Math.round(r?.distance_m || 0),
    durationS: Math.round(r?.duration_s || 0),
    eta: new Date(Date.now() + (r?.duration_s || 0) * 1000).toISOString(),
    leadMin: state.leadTimeMin,
  });
  go('active');
  requestWakeLock();
  if (r) mapView.showRoute('activeMap', state.origin, state.dest, r.coordinates, { live: true });
  alarm.begin();
  toast('Journey started · alarm armed');
}
function stopJourney(silent) {
  alarm.end();
  releaseWakeLock();
  state.journeyActive = false;
  state.journeyId = null;
  if (el('ongoingBadge')) el('ongoingBadge').style.display = 'none';
  if (!silent) toast('Journey ended · alarm cancelled');
  state.navStack = [];
  go('home', true);
}
function dismissAlarm() {
  el('alarmRing').classList.remove('show');
  alarm.silence();
  releaseWakeLock();
  state.journeyActive = false;
  state.journeyId = null;
  if (el('ongoingBadge')) el('ongoingBadge').style.display = 'none';
  state.navStack = [];
  go('home', true);
}
async function resumeJourney() {
  if (state.journeyActive) { go('active'); return; }
  const resumed = await resumeActiveJourney();
  if (!resumed) toast('No journey in progress');
}

// Restore an in-progress journey (e.g. after a page reload). The journey row
// persists in storage; we rebuild state, recompute the route geometry, and
// restart live tracking from the current position.
async function resumeActiveJourney() {
  if (state.journeyActive) return true;
  let j;
  try { j = await db.getActiveJourney(); } catch { j = null; }
  if (!j) return false;
  const oLng = j.origin_lng ?? j.originLng, oLat = j.origin_lat ?? j.originLat;
  const dLng = j.dest_lng ?? j.destLng, dLat = j.dest_lat ?? j.destLat;
  if (dLng == null || dLat == null) return false;
  state.dest = { name: j.dest_label ?? j.destLabel ?? 'Destination', address: '', lng: dLng, lat: dLat };
  state.origin = { name: 'Your location', address: '', lng: oLng, lat: oLat, fallback: oLng == null };
  state.mode = j.mode || 'car';
  state.journeyId = j.id;

  // Need route geometry for distance-along-route tracking; recompute it.
  if (state.origin.lng != null) {
    const route = await getRoute(state.origin, state.dest, state.mode);
    if (route) state.routes[state.mode] = route;
  }
  const r = state.routes[state.mode];
  state.journeyActive = true;
  if (el('ongoingBadge')) el('ongoingBadge').style.display = 'inline-block';
  if (el('liveDest')) el('liveDest').textContent = state.dest.name;
  if (el('liveTone')) el('liveTone').textContent = soundLabel();
  go('active', true);
  requestWakeLock();
  if (r) mapView.showRoute('activeMap', state.origin, state.dest, r.coordinates, { live: true });
  alarm.begin();
  toast('Resumed your journey');
  return true;
}

// ===========================================================================
// Search input (live geocode)
// ===========================================================================
let searchHits = [];
function wireSearch() {
  const input = el('searchInput');
  const results = el('searchResults');
  if (!input || !results) return;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) {
      results.innerHTML = '';
      results.style.display = 'none';
      return;
    }
    searchPlacesDebounced(q, (hits) => {
      // Keep results in memory and reference them by index — never embed
      // third-party JSON in an attribute (attribute-injection / XSS vector).
      searchHits = hits;
      results.style.display = hits.length ? 'block' : 'none';
      results.innerHTML = hits
        .map(
          (h, i) => `
        <div class="recent-item" data-result-idx="${i}">
          <div class="r-ic"><svg><use href="#i-pin"/></svg></div>
          <div class="r-body"><div class="t">${esc(h.name)}</div><div class="s">${esc(h.address)}</div></div>
        </div>`
        )
        .join('');
    });
  });
}

// ===========================================================================
// Onboarding / theme / review
// ===========================================================================
let obIdx = 0;
function obNext() {
  if (obIdx < 2) obGo(obIdx + 1);
  else finishOnboarding();
}
function obGo(i) {
  obIdx = i;
  document.querySelectorAll('.ob-slide').forEach((s, n) => s.classList.toggle('active', n === i));
  document.querySelectorAll('#obDots i').forEach((d, n) => d.classList.toggle('on', n === i));
  el('obNext').textContent = i === 2 ? 'Enable location & start' : 'Continue';
}
async function finishOnboarding() {
  try { localStorage.setItem('aoc_onboarded', '1'); } catch { /* private mode */ }
  el('onboarding').classList.remove('active');
  gate();
  // Prime BEFORE the OS prompt — a bare system dialog with no context is the
  // single easiest way to get denied. Android also enforces incremental
  // requests, so this asks for foreground location + notifications only; the
  // reliability panel walks the user to "Allow all the time" separately.
  if (isNative) {
    const go = await showSheet({
      title: 'Two quick permissions',
      body: 'ArriveO’Clock needs your location to follow the route, and notifications to sound the alarm. Without them it can’t wake you.',
      ok: 'Continue',
      cancel: 'Skip for now',
    });
    if (go) await requestBasePermissions();
    refreshPermissions({ render: false });
  }
  // Only pre-warm location if we actually land on home now.
  if (DEMO || state.user) locateOnHome();
}
function replayOnboarding() {
  // Hide whatever view is showing (e.g. Settings) — otherwise it stays painted
  // on top of onboarding since both are .view.full at the same z-index.
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  el('tabbar').style.display = 'none'; // onboarding is immersive
  obGo(0);
  el('onboarding').classList.add('active');
  state.navStack = [];
  window.scrollTo(0, 0);
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-th]').forEach((b) => b.classList.toggle('active', b.dataset.th === t));
  mapView.refreshTheme();
  try { localStorage.setItem('aoc_theme', t); } catch { /* ignore */ }
  if (state.user) db.updateProfile({ theme: t });
}

let rating = 0;
function submitReview() {
  if (!rating) { toast('Tap the stars to rate'); return; }
  db.submitReview({ rating, comment: el('reviewText')?.value || '' });
  try { localStorage.setItem('aoc_rated', String(rating)); } catch { /* private mode */ }
  toast('Thanks for the feedback!');
  if (el('reviewText')) el('reviewText').value = '';
  rating = 0;
  document.querySelectorAll('#stars .star').forEach((s) => s.classList.remove('on'));
  renderProfile(); // swap the "Rate" row → "Share"
  setTimeout(goBack, 600);
}

// ===========================================================================
// Bottom-sheet drag
// ===========================================================================
function enableSheetDrag(sheet) {
  if (!sheet) return;
  const grip = sheet.querySelector('.grip');
  if (!grip) return;
  let startY = 0, baseY = 0, dragging = false, collapsed = false;
  const collapsedY = () => sheet.offsetHeight - 150;
  const down = (y) => { dragging = true; startY = y; baseY = collapsed ? collapsedY() : 0; sheet.style.transition = 'none'; };
  const move = (y) => { if (!dragging) return; let dy = baseY + (y - startY); dy = Math.max(0, Math.min(collapsedY(), dy)); sheet.style.transform = `translateY(${dy}px)`; };
  const up = (y) => { if (!dragging) return; dragging = false; sheet.style.transition = ''; const dy = baseY + (y - startY); collapsed = dy > collapsedY() * 0.4; sheet.style.transform = `translateY(${collapsed ? collapsedY() : 0}px)`; };
  grip.addEventListener('touchstart', (e) => down(e.touches[0].clientY), { passive: true });
  grip.addEventListener('touchmove', (e) => move(e.touches[0].clientY), { passive: true });
  grip.addEventListener('touchend', (e) => up(e.changedTouches[0].clientY));
  grip.addEventListener('mousedown', (e) => {
    down(e.clientY);
    const mm = (ev) => move(ev.clientY);
    const mu = (ev) => { up(ev.clientY); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
  });
}

// ===========================================================================
// Toast
// ===========================================================================
let toastTimer = null;
function toast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ===========================================================================
// Auth gating
// ===========================================================================
function routeAfterAuth() {
  if (!DEMO && !state.user) {
    go('login', true);
  } else {
    go('home', true);
  }
}

// On web, show the mobile-app waitlist once (before the login screen) to
// signed-out users. Never shown in the native app.
function waitlistDone() {
  try { return localStorage.getItem('aoc_waitlist') === '1'; } catch { return true; }
}
function gate() {
  if (!isNative && !DEMO && !state.user && !state.guest && !waitlistDone()) {
    go('waitlist', true);
  } else {
    routeAfterAuth();
  }
}
function finishWaitlist() {
  try { localStorage.setItem('aoc_waitlist', '1'); } catch { /* ignore */ }
  routeAfterAuth();
}
async function waitlistJoin() {
  const email = (el('waitlistEmail')?.value || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email'); return; }
  try { await db.joinWaitlist(email); } catch { /* best effort */ }
  toast("You're on the list!");
  finishWaitlist();
}
function waitlistSkip() { finishWaitlist(); }

// On the web the landing page IS the product surface: the locked-screen alarm
// needs the native app, so web visitors are funnelled to the waitlist rather
// than into the (limited) web app. Shows the full-bleed marketing page, lets
// the window scroll, hides the phone-frame shell, and lazy-loads the GSAP
// scroll experience. Never runs on native.
function showWebLanding() {
  document.documentElement.classList.add('lp-mode');
  document.body.classList.add('lp-mode');
  el('landingPage')?.classList.add('show');
  import('./landing.js').then((m) => m.initLanding()).catch(() => {});
}

async function afterLogin() {
  if (!state.user) state.user = await auth.getCurrentUser();
  if (!state.user) return;
  const p = await db.loadProfile();
  // Apply persisted preferences.
  state.leadTimeMin = p.lead_time_min ?? 5;
  state.tone = p.alarm_tone || 'Lo-fi';
  state.vibrate = p.vibrate ?? true;
  state.fadeIn = p.volume_fade ?? false;
  state.units = p.units || 'km';
  if (p.theme) setTheme(p.theme);
  renderLead();
  renderUnits();
  syncToggles();
  renderRingtone(); // also re-renders the tone list
  await Promise.all([db.getRecents(), db.getSavedPlaces()]);
  renderRecents();
  renderSaved();
  renderProfile();
}

// Continue without an account (shared by the action map + window export).
async function doGuest() {
  auth.continueAsGuest();
  try { localStorage.setItem('aoc_onboarded', '1'); } catch { /* ignore */ }
  await afterLogin();
  el('onboarding')?.classList.remove('active');
  go('home', true);
  locateOnHome();
}

// Declarative action map — values for `data-act="verb:arg"` on buttons/rows.
// Replaces inline onclick handlers so the CSP can forbid inline scripts.
const ACTIONS = {
  back: () => goBack(),
  searchBack: () => searchBack(),
  search: () => openSearch(),
  go: (a) => go(a),
  tab: (a) => tabGo(a),
  picker: (a) => openPicker(a),
  saved: (a) => pickSaved(a),
  theme: (a) => setTheme(a),
  toast: (a) => toast(a),
  mode: (_a, elm) => applyMode(elm.dataset.mode),
  swap: () => swapRoute(),
  start: () => startJourney(),
  stop: () => stopJourney(),
  dismiss: () => dismissAlarm(),
  resume: () => resumeJourney(),
  locate: () => locateOnHome(true),
  addPlace: () => openEditPlace(null),
  saveEdit: () => saveEditPlace(),
  deleteEdit: () => deleteEditPlace(),
  submitReview: () => submitReview(),
  signIn: () => auth.signInWithGoogle(),
  signOut: () => auth.signOut(),
  guest: () => doGuest(),
  finishOnboarding: () => finishOnboarding(),
  waitlistJoin: () => waitlistJoin(),
  waitlistSkip: () => waitlistSkip(),
  obNext: () => obNext(),
  replayOnboarding: () => replayOnboarding(),
  clearRecents: async () => { await db.clearRecents(); renderRecents(); toast('History cleared'); },
  soundSaved: () => { goBack(); toast('Sound saved'); },
  toggleVibrate: () => {
    state.vibrate = !state.vibrate;
    db.updateProfile({ vibrate: state.vibrate });
    syncToggles(); // the same switch appears on Settings AND Alarm sound
    toast(state.vibrate ? 'Vibration on' : 'Vibration off');
  },
  toggleFadeIn: () => {
    state.fadeIn = !state.fadeIn;
    db.updateProfile({ volume_fade: state.fadeIn });
    syncToggles();
    toast(state.fadeIn ? `Alarm fades in over ${FADE_SEC}s` : 'Alarm starts at full volume');
  },
  openLocationSettings: () => openNativeSettings(),
  openAppSettings: () => openNativeSettings(),
  shareApp: () => shareApp(),
  ringtone: (a) => handleRingtone(a),
  perm: (a) => {
    if (a === 'recheck') { refreshPermissions(); toast('Re-checked'); return; }
    if (a && a.startsWith('fix:')) fixPermission(a.slice(4));
  },
};

// Open the device's settings page for this app (location "Allow all the time",
// notifications). On web there's nothing to open — point the user at the browser.
async function openNativeSettings() {
  if (!isNative) { toast('Manage this in your browser’s site settings'); return; }
  const ok = await openAppSettings();
  if (ok) toast('Set Location to “Allow all the time”');
  else toast('Open ArriveO’Clock in system Settings to adjust permissions');
}

// Share the app (native share sheet where available, else copy the link).
async function shareApp() {
  const url = 'https://arriveoclock.vercel.app';
  try {
    if (navigator.share) {
      await navigator.share({ title: "ArriveO'Clock", text: 'Sleep on the metro — this wakes you right before your stop.', url });
      return;
    }
  } catch { return; /* user dismissed the share sheet */ }
  try { await navigator.clipboard.writeText(url); toast('Link copied — share it anywhere'); }
  catch { toast(url); }
}

// ===========================================================================
// Song ringtones (see ringtone.js). The alarm sound is EITHER a built-in tone
// OR a song — picking one clears the other, so there's a single answer to
// "what will ring?".
// ===========================================================================

// What to show wherever the alarm sound is named.
function soundLabel() {
  return getRingtone()?.name || state.tone || 'Lo-fi';
}

function setRingtoneStatus(msg) {
  const box = el('ringtoneStatus');
  if (!box) return;
  box.style.display = msg ? 'flex' : 'none';
  const span = box.querySelector('span');
  if (span) span.textContent = msg || '';
}

function renderRingtone() {
  const r = getRingtone();
  const row = el('ringtoneCurrent');
  if (row) {
    row.style.display = r ? 'flex' : 'none';
    el('ringtoneName').textContent = r ? r.name : '—';
    // Creative-Commons material must carry its credit.
    el('ringtoneMeta').textContent = r
      ? (r.attribution || 'From your device · tap to preview')
      : 'Tap to preview';
  }
  if (el('soundVal')) el('soundVal').textContent = soundLabel();
  if (el('liveTone')) el('liveTone').textContent = soundLabel();
  renderTones(); // checkmarks depend on whether a song is active
}

async function chooseLocalSong() {
  setRingtoneStatus('Opening your music…');
  try {
    const file = await pickLocalAudio();
    if (!file) { setRingtoneStatus(''); return; }
    setRingtoneStatus(`Saving “${file.name}”…`);
    await useLocalFile(file);
    renderRingtone();
    setRingtoneStatus('');
    toast('Alarm song set');
    previewRingtone();
  } catch (err) {
    setRingtoneStatus('');
    toast(err?.message || 'Could not use that file');
  }
}

let freeHits = [];
let freeAbort = null;
let freeTimer = null;

function renderFreeResults(items, note) {
  const wrap = el('ringtoneResults');
  if (!wrap) return;
  if (note) {
    wrap.innerHTML = `<div class="s-row"><div class="s-body"><div class="d">${esc(note)}</div></div></div>`;
    return;
  }
  freeHits = items;
  wrap.innerHTML = items
    .map(
      (h, i) => `
    <div class="s-row" data-free-idx="${i}">
      <div class="s-ic"><svg><use href="#i-music"/></svg></div>
      <div class="s-body"><div class="t">${esc(h.title)}</div><div class="d">${esc(h.creator)}</div></div>
      <svg class="chev"><use href="#i-go"/></svg>
    </div>`
    )
    .join('');
}

function wireRingtoneSearch() {
  const input = el('ringtoneSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(freeTimer);
    if (freeAbort) freeAbort.abort();
    if (q.length < 2) { renderFreeResults([], 'Type to search free music.'); return; }
    renderFreeResults([], 'Searching…');
    freeTimer = setTimeout(async () => {
      freeAbort = new AbortController();
      try {
        const hits = await searchFreeMusic(q, freeAbort.signal);
        renderFreeResults(hits, hits.length ? '' : 'Nothing found — try different words.');
      } catch (err) {
        if (err?.name !== 'AbortError') renderFreeResults([], 'Search failed — check your connection.');
      }
    }, 350);
  });
}

async function useFreeHit(hit) {
  // Downloaded up front on purpose: the alarm has to ring underground, with no
  // signal, so nothing may depend on the network at ring time.
  setRingtoneStatus(`Downloading “${hit.title}” for offline use…`);
  try {
    await useFreeTrack(hit);
    renderRingtone();
    setRingtoneStatus('');
    toast('Alarm song set');
    previewRingtone();
  } catch (err) {
    setRingtoneStatus('');
    toast(err?.message || 'Download failed');
  }
}

async function handleRingtone(action) {
  if (action === 'pick') return chooseLocalSong();
  if (action === 'preview') { previewRingtone(); return; }
  if (action === 'clear') {
    stopRingtone();
    await clearRingtone();
    renderRingtone();
    toast('Back to the built-in tone');
    return;
  }
  if (action === 'browse') {
    const box = el('ringtoneBrowse');
    if (!box) return;
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    if (!open) {
      renderFreeResults([], 'Type to search free music.');
      setTimeout(() => el('ringtoneSearch')?.focus(), 80);
    }
  }
}

// Some switches are duplicated across screens (Vibrate lives on both Settings
// and Alarm sound), so every copy is kept in step from the single state value.
function syncToggles() {
  document.querySelectorAll('[data-act="toggleVibrate"]').forEach((t) =>
    t.classList.toggle('on', state.vibrate !== false)
  );
  document.querySelectorAll('[data-act="toggleFadeIn"]').forEach((t) =>
    t.classList.toggle('on', Boolean(state.fadeIn))
  );
}


// ===========================================================================
// Alarm reliability: permissions.
//
// Location "always", notifications and battery-unrestricted all fail with the
// SAME symptom — the alarm stays silent — and users blame the app, not Android.
// So each is reported separately, with a route to the exact settings page.
// ===========================================================================

// Ordered by how badly the alarm breaks without them.
const PERM_ITEMS = [
  { key: 'fineLocation', icon: 'i-locate', title: 'Location access',
    why: 'Needed to see where you are on the route.', target: 'app' },
  { key: 'backgroundLocation', icon: 'i-map', title: 'Location: Allow all the time',
    why: 'Android hides this from the popup — it can only be set here. Without it, tracking stops the moment your screen locks.', target: 'app' },
  { key: 'notifications', icon: 'i-bell', title: 'Notifications',
    why: 'Carries the alarm itself and the tracking notice. If off, background tracking stops.', target: 'notifications' },
  { key: 'batteryUnrestricted', icon: 'i-bolt', title: 'Battery: unrestricted',
    why: 'Xiaomi, Samsung, OnePlus, Oppo, Vivo and Realme kill the tracking service without this.', target: 'battery' },
  { key: 'exactAlarms', icon: 'i-alarm', title: 'Alarms & reminders',
    why: 'Lets the alarm fire at an exact time even in Doze.', target: 'exactAlarm' },
];

let permCache = null;

async function refreshPermissions({ render = true } = {}) {
  permCache = await permissionStatus();
  if (render) renderPermissions();
  updatePermSummary();
  return permCache;
}

function updatePermSummary() {
  const badge = el('permSummary');
  if (!badge || !permCache) return;
  if (!permCache.supported) { badge.textContent = 'Not applicable on web'; return; }
  const missing = PERM_ITEMS.filter((i) => !permCache[i.key]).length;
  badge.textContent = missing ? `${missing} need${missing === 1 ? 's' : ''} attention` : 'All set';
}

function renderPermissions() {
  const wrap = el('permList');
  if (!wrap) return;
  if (!permCache) { wrap.innerHTML = '<div class="s-row"><div class="s-body"><div class="d">Checking…</div></div></div>'; return; }
  if (!permCache.supported) {
    wrap.innerHTML = '<div class="s-row"><div class="s-body"><div class="t">Nothing to grant here</div><div class="d">These are native permissions — they apply in the installed app.</div></div></div>';
    return;
  }
  wrap.innerHTML = PERM_ITEMS.map((item) => {
    const ok = Boolean(permCache[item.key]);
    return `
    <div class="s-row ${ok ? '' : 'perm-bad'}" ${ok ? '' : `data-act="perm:fix:${item.key}"`}>
      <div class="s-ic"><svg><use href="#${item.icon}"/></svg></div>
      <div class="s-body">
        <div class="t">${esc(item.title)}</div>
        <div class="d">${esc(ok ? 'Granted' : item.why)}</div>
      </div>
      <span class="perm-pill ${ok ? 'ok' : 'bad'}">${ok ? 'On' : 'Fix'}</span>
    </div>`;
  }).join('');
}

async function fixPermission(key) {
  const item = PERM_ITEMS.find((i) => i.key === key);
  if (!item) return;
  await openSetting(item.target);
  // The user leaves for Settings; re-check when they come back.
  toast('Switch it on, then return here');
}

// ---------------------------------------------------------------------------
// In-app confirm sheet. Replaces window.confirm(), which in a WebView renders
// as a bare Chrome dialog captioned with the localhost origin.
// ---------------------------------------------------------------------------
let sheetResolve = null;

function showSheet({ title, body, ok = 'Open Settings', cancel = 'Not now' }) {
  return new Promise((resolve) => {
    const scrim = el('sheetScrim');
    if (!scrim) { resolve(false); return; }
    el('csTitle').textContent = title;
    el('csBody').textContent = body;
    el('csOk').textContent = ok;
    el('csCancel').textContent = cancel;
    scrim.hidden = false;
    sheetResolve = resolve;
    setTimeout(() => el('csOk')?.focus(), 40);
  });
}

function closeSheet(result) {
  const scrim = el('sheetScrim');
  if (scrim) scrim.hidden = true;
  const r = sheetResolve;
  sheetResolve = null;
  if (r) r(result);
}

function wireSheet() {
  el('csOk')?.addEventListener('click', () => closeSheet(true));
  el('csCancel')?.addEventListener('click', () => closeSheet(false));
  el('sheetScrim')?.addEventListener('click', (e) => {
    if (e.target === el('sheetScrim')) closeSheet(false);
  });
  // The background watcher can only report this at runtime; prompt in-app.
  window.addEventListener('aoc:location-denied', async () => {
    if (sheetResolve) return; // already asking
    const go = await showSheet({
      title: 'Allow location all the time',
      body: 'To wake you with the screen locked, ArriveO’Clock needs location set to “Allow all the time”. Android hides that option from the popup, so it has to be switched on in Settings.',
    });
    if (go) openSetting('app');
  });
}


// ===========================================================================
// Keyboard operability.
//
// Most rows in this app are clickable <div>s driven by the delegated handler
// below — 19 in the static markup and many more rendered at runtime (recents,
// saved places, tones, search hits, permissions). None were focusable and there
// were no key handlers, so the whole app was unusable without a touchscreen.
//
// Rather than rewrite every row as a <button> (which would mean unpicking the
// layout CSS), interactive rows are given button semantics and Enter/Space is
// translated into a click. A MutationObserver covers the dynamic ones.
// ===========================================================================
const INTERACTIVE_SEL = [
  '[data-act]', '[data-pick]', '[data-tone]', '[data-result-idx]',
  '[data-free-idx]', '[data-lead]', '[data-unit]', '[data-icon]',
  '[data-th]', '[data-go]', '[data-edit]', '[data-mode]',
].join(',');

const NATIVELY_INTERACTIVE = 'button, a[href], input, select, textarea';

function enhanceInteractive(root) {
  const scope = root && root.querySelectorAll ? root : document;
  let nodes = scope.querySelectorAll(INTERACTIVE_SEL);
  nodes.forEach((node) => {
    if (node.matches(NATIVELY_INTERACTIVE)) return; // already operable
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
    if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
  });
  // The root itself may be an interactive node added wholesale.
  if (root instanceof HTMLElement && root.matches?.(INTERACTIVE_SEL)
      && !root.matches(NATIVELY_INTERACTIVE)) {
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');
    if (!root.hasAttribute('role')) root.setAttribute('role', 'button');
  }
}

function wireKeyboard() {
  enhanceInteractive(document);

  // Rows are re-rendered constantly via innerHTML; keep new ones operable.
  try {
    new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType === 1) enhanceInteractive(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  } catch { /* very old webview — static rows still work */ }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.matches(NATIVELY_INTERACTIVE)) return; // browser handles these
    const hit = t.closest(INTERACTIVE_SEL);
    if (!hit) return;
    e.preventDefault(); // Space would otherwise scroll the page
    hit.click();
  });
}

// Reflect persisted settings on the controls that aren't auto-rendered elsewhere.
function syncSettingsUI() {
  syncToggles();
  if (el('soundVal')) el('soundVal').textContent = soundLabel();
  renderLead();
  renderUnits();
}

// ===========================================================================
// Global delegated click handling (for dynamically rendered rows)
// ===========================================================================
function wireDelegation() {
  document.addEventListener('click', async (e) => {
    const t = e.target;

    // Declarative actions (replaces inline onclick handlers → strict CSP).
    const actEl = t.closest?.('[data-act]');
    if (actEl) {
      const spec = actEl.dataset.act;
      const i = spec.indexOf(':');
      const verb = i === -1 ? spec : spec.slice(0, i);
      const arg = i === -1 ? undefined : spec.slice(i + 1);
      const fn = ACTIONS[verb];
      if (fn) fn(arg, actEl);
      return;
    }

    // star rating
    const star = t.closest?.('.star');
    if (star) {
      rating = +star.dataset.v;
      document.querySelectorAll('#stars .star').forEach((s) => s.classList.toggle('on', +s.dataset.v <= rating));
      return;
    }

    // edit a saved place (pencil) — checked before data-pick
    const edit = t.closest?.('[data-edit]');
    if (edit) {
      const place = state.saved.find((p) => String(p.id) === edit.dataset.edit);
      if (place) openEditPlace(place);
      return;
    }

    // lead-time selector (Settings)
    const lead = t.closest?.('[data-lead]');
    if (lead) {
      setLeadTime(+lead.dataset.lead);
      return;
    }

    // units selector (Settings)
    const unit = t.closest?.('[data-unit]');
    if (unit) {
      setUnits(unit.dataset.unit);
      return;
    }

    // icon picker in the editor
    const iconBtn = t.closest?.('[data-icon]');
    if (iconBtn) {
      state.editing.icon = iconBtn.dataset.icon;
      renderEditIcons();
      return;
    }

    // recents / saved pick → routed through the unified chooser
    const pick = t.closest?.('[data-pick]');
    if (pick) {
      const [kind, id] = pick.dataset.pick.split(':');
      const place = (kind === 'recent' ? state.recents : state.saved).find((p) => String(p.id) === id);
      if (place) choosePlace(place);
      return;
    }

    // search result pick (by index into the in-memory results)
    const res = t.closest?.('[data-result-idx]');
    if (res) {
      const hit = searchHits[+res.dataset.resultIdx];
      if (hit) choosePlace(hit);
      resetSearchInput();
      return;
    }

    // free-music result pick (by index into the in-memory results)
    const free = t.closest?.('[data-free-idx]');
    if (free) {
      const hit = freeHits[+free.dataset.freeIdx];
      if (hit) useFreeHit(hit);
      return;
    }

    // tone pick — select, persist, and preview it once. A built-in tone and a
    // song are mutually exclusive, so this drops any chosen song.
    const tone = t.closest?.('[data-tone]');
    if (tone) {
      state.tone = tone.dataset.tone;
      db.updateProfile({ alarm_tone: state.tone });
      if (getRingtone()) clearRingtone();
      renderRingtone();
      previewTone(state.tone);
      return;
    }
  });
}

// ===========================================================================
// Quick chip → saved place (honours picker mode too)
// ===========================================================================
function pickSaved(kind) {
  const place = state.saved.find((p) => p.kind === kind) || state.saved[0];
  if (place) choosePlace(place);
  else go('saved');
}

// ===========================================================================
// Init
// ===========================================================================
async function init() {
  logConfig();
  try { console.log("ArriveO'Clock build", __BUILD_ID__, '· platform', isNative ? 'native' : 'web'); } catch { /* ignore */ }

  try { const th = localStorage.getItem('aoc_theme'); if (th) setTheme(th); } catch { /* ignore */ }

  // After Supabase consumes the OAuth tokens it leaves a bare/`#access_token`
  // hash in the URL — tidy it.
  if (location.hash && /access_token|error|^#\/?$/.test(location.hash)) {
    setTimeout(() => history.replaceState(null, '', location.pathname + location.search), 0);
  }

  // NO service worker anywhere. It cached assets by filename and served STALE
  // JS across updates — inside the native WebView its cache even survives APK
  // reinstalls, so new builds kept running old code. Always unregister any
  // existing SW and wipe all caches so previously-poisoned installs recover.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
  }
  if (window.caches) {
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }

  // UI wiring that doesn't depend on the signed-in user.
  state.tone = 'Lo-fi';
  renderTones();
  renderRingtone();
  renderLead();
  renderUnits();
  syncToggles();
  enableSheetDrag(el('homeSheet'));
  wireSearch();
  wireRingtoneSearch();
  wireDelegation();
  wireSheet();
  wireKeyboard();
  onHardwareBack(handleHardwareBack);
  // Escape closes the sheet for keyboard users.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('sheetScrim')?.hidden) closeSheet(false);
  });
  // Permissions get revoked by the OS after periods of non-use, and the user
  // may have just returned from Settings — so re-check whenever we resume.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshPermissions({ render: document.querySelector('.view.active')?.id === 'permissions' });
  });
  refreshPermissions({ render: false });
  // On native, background tracking works — the "keep screen open" web caveat
  // doesn't apply, so drop that note. Also register the OAuth deep-link handler.
  if (isNative) {
    // Scoped to the journey screen — other views reuse this class for hints.
    document.querySelector('#active .keep-open')?.remove();
    auth.initNativeAuth();
  }
  // The map (and its ~800 kB MapLibre chunk) loads lazily when Home is shown —
  // not during onboarding/login.

  // WEB: the landing + waitlist is the entire web experience — the locked-screen
  // alarm needs the native app, so we funnel web visitors to the waitlist
  // instead of booting the (limited) web app. Never reached on native/DEMO.
  if (!isNative && !DEMO) { showWebLanding(); return; }

  let onboarded = false;
  try { onboarded = localStorage.getItem('aoc_onboarded') === '1'; } catch { /* ignore */ }
  // Restore a guest session (chosen "continue without an account") before
  // resolving auth, so getCurrentUser returns the local guest user.
  try { state.guest = localStorage.getItem('aoc_guest') === '1'; } catch { /* ignore */ }

  // Resolve auth BEFORE any user-scoped Supabase query.
  state.user = await auth.getCurrentUser();
  if (state.user) await afterLogin();

  if (onboarded) {
    el('onboarding').classList.remove('active');
    gate();
    if (state.user) {
      // Resume an in-progress journey if one exists; otherwise locate on home.
      const resumed = await resumeActiveJourney();
      if (!resumed) locateOnHome();
    }
  }

  // Backstop: the OAuth session can land just after init (redirect round-trip).
  // When it does, finish login and move off the login/onboarding screen.
  auth.onAuthChange(async (user) => {
    // A real Supabase sign-in supersedes any local guest session.
    if (user && state.guest) { state.guest = false; try { localStorage.removeItem('aoc_guest'); } catch { /* ignore */ } }
    const prevId = state.user?.id || null;
    const justSignedIn = !!user && !prevId;
    state.user = user;
    // Only (re)load data when the account actually changes — avoids a
    // redundant fetch on the INITIAL_SESSION event init already handled.
    if (user && user.id !== prevId) { await afterLogin(); renderProfile(); }
    if (justSignedIn) {
      try { localStorage.setItem('aoc_onboarded', '1'); } catch { /* ignore */ }
      el('onboarding').classList.remove('active');
      const cur = document.querySelector('.view.active')?.id;
      if (cur === 'login' || cur === 'onboarding') { go('home', true); locateOnHome(); }
    }
  });
}

// ===========================================================================
// Expose handlers used by inline markup
// ===========================================================================
Object.assign(window, {
  go, tabGo, goBack, setMode, swapRoute, startJourney, stopJourney, dismissAlarm,
  resumeJourney, obNext, finishOnboarding, replayOnboarding, setTheme, submitReview,
  toast, pickSaved, openSearch, openPicker, searchBack,
  openEditPlace, saveEditPlace, deleteEditPlace,
  locateMe: () => locateOnHome(true),
  clearRecents: async () => { await db.clearRecents(); renderRecents(); toast('History cleared'); },
  signIn: () => auth.signInWithGoogle(),
  signOut: () => auth.signOut(),
  continueAsGuest: () => doGuest(),
});

init();
