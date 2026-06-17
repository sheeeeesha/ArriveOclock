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
import { chirp, previewTone } from './sound.js';

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
  if (id === 'profile') renderStats();
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
  wrap.innerHTML = TONES.map(
    (t) => `
    <div class="s-row" data-tone="${t}">
      <div class="s-ic"><svg><use href="#i-music"/></svg></div>
      <div class="s-body"><div class="t">${t}</div></div>
      <svg class="chev" style="opacity:${t === state.tone ? 1 : 0}" data-check><use href="#i-go"/></svg>
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
async function startJourney() {
  const r = state.routes[state.mode];
  state.journeyActive = true;
  if (el('ongoingBadge')) el('ongoingBadge').style.display = 'inline-block';
  if (el('liveDest')) el('liveDest').textContent = state.dest?.name || '';
  if (el('liveTone')) el('liveTone').textContent = state.tone;
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
  if (r) mapView.showRoute('activeMap', state.origin, state.dest, r.coordinates, { live: true });
  alarm.begin();
  toast('Journey started · alarm armed');
}
function stopJourney(silent) {
  alarm.end();
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
  if (el('liveTone')) el('liveTone').textContent = state.tone;
  go('active', true);
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
  routeAfterAuth();
  // Ask for location and show the user's marker on the map.
  locateOnHome();
}
function replayOnboarding() {
  obGo(0);
  el('onboarding').classList.add('active');
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
  toast('Thanks for the feedback!');
  if (el('reviewText')) el('reviewText').value = '';
  rating = 0;
  document.querySelectorAll('#stars .star').forEach((s) => s.classList.remove('on'));
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

async function afterLogin() {
  if (!state.user) state.user = await auth.getCurrentUser();
  if (!state.user) return;
  const p = await db.loadProfile();
  // Apply persisted preferences.
  state.leadTimeMin = p.lead_time_min ?? 5;
  state.tone = p.alarm_tone || 'Lo-fi';
  state.vibrate = p.vibrate ?? true;
  state.units = p.units || 'km';
  if (p.theme) setTheme(p.theme);
  renderLead();
  renderUnits();
  renderTones();
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
  obNext: () => obNext(),
  replayOnboarding: () => replayOnboarding(),
  clearRecents: async () => { await db.clearRecents(); renderRecents(); toast('History cleared'); },
  soundSaved: () => { goBack(); toast('Sound saved'); },
  toggle: (_a, elm) => elm.classList.toggle('on'),
};

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

    // tone pick — select, persist, and preview it once
    const tone = t.closest?.('[data-tone]');
    if (tone) {
      state.tone = tone.dataset.tone;
      db.updateProfile({ alarm_tone: state.tone });
      renderTones();
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

  try { const th = localStorage.getItem('aoc_theme'); if (th) setTheme(th); } catch { /* ignore */ }

  // After Supabase consumes the OAuth tokens it leaves a bare/`#access_token`
  // hash in the URL — tidy it.
  if (location.hash && /access_token|error|^#\/?$/.test(location.hash)) {
    setTimeout(() => history.replaceState(null, '', location.pathname + location.search), 0);
  }

  // Register the service worker (production builds only — avoids caching the
  // dev modules during local development).
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // UI wiring that doesn't depend on the signed-in user.
  state.tone = 'Lo-fi';
  renderTones();
  renderLead();
  renderUnits();
  enableSheetDrag(el('homeSheet'));
  wireSearch();
  wireDelegation();
  // The map (and its ~800 kB MapLibre chunk) loads lazily when Home is shown —
  // not during onboarding/login.

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
    routeAfterAuth();
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
