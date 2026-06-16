import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TILES_STYLE_SOURCE, TILES_GLYPHS, DEFAULT_CENTER } from './config.js';

// ---------------------------------------------------------------------------
// Monochrome cartography — MapLibre GL on free, keyless OpenFreeMap vector
// tiles (OpenMapTiles schema), styled to a strict grayscale palette. Works
// globally with no API key. A black/white animated line draws the route.
// If tiles fail to load (offline), we fall back to an illustrative SVG map.
// ---------------------------------------------------------------------------

const PALETTE = {
  light: {
    land: '#e9e9e9', land2: '#e1e1e1', block: '#f1f1f1', water: '#cdcdcd',
    road: '#ffffff', roadMajor: '#c2c2c2', label: '#7c7c7c', halo: '#f4f4f4',
    route: '#0a0a0a', routeHalo: '#ffffff',
  },
  dark: {
    land: '#161616', land2: '#1d1d1d', block: '#0e0e0e', water: '#252525',
    road: '#2f2f2f', roadMajor: '#444444', label: '#8f8f8f', halo: '#000000',
    route: '#ffffff', routeHalo: '#000000',
  },
};

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function monoStyle(theme) {
  const c = PALETTE[theme];
  return {
    version: 8,
    name: 'aoc-mono',
    glyphs: TILES_GLYPHS,
    sources: { openmaptiles: { type: 'vector', url: TILES_STYLE_SOURCE } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.land } },
      { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        paint: { 'fill-color': c.land2, 'fill-opacity': 0.5 } },
      { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        paint: { 'fill-color': c.land2, 'fill-opacity': 0.5 } },
      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
        paint: { 'fill-color': c.land2, 'fill-opacity': 0.7 } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
        paint: { 'line-color': c.water, 'line-width': 1.2 } },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building',
        minzoom: 13, paint: { 'fill-color': c.block, 'fill-opacity': 0.7 } },
      { id: 'roads-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'],
          ['minor', 'service', 'track', 'path', 'pedestrian'], true, false],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 3] } },
      { id: 'roads-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.roadMajor, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 16, 6] } },
      { id: 'place-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'neighbourhood'], true, false],
        layout: {
          'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 14, 15],
          'text-letter-spacing': 0.06,
          'text-transform': 'uppercase',
        },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
    ],
  };
}

// --- registry of live map instances, keyed by container id -----------------
const maps = new Map(); // id -> { map, markers, dashTimer, hasRoute }

function getOrCreate(id) {
  if (maps.has(id)) return maps.get(id);
  const map = new maplibregl.Map({
    container: id,
    style: monoStyle(currentTheme()),
    center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
    zoom: 11.5,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  const entry = { map, markers: {}, dashTimer: null, hasRoute: false };
  maps.set(id, entry);
  return entry;
}

function makeHereEl() {
  const el = document.createElement('div');
  el.className = 'mb-here';
  el.innerHTML = '<span class="mb-here-pulse"></span><span class="mb-here-dot"></span>';
  return el;
}
function makeDestEl() {
  const el = document.createElement('div');
  el.className = 'mb-pin';
  el.innerHTML =
    '<svg viewBox="0 0 24 32"><path d="M12 31s10-9 10-19A10 10 0 1 0 2 12c0 10 10 19 10 19z"/><circle cx="12" cy="12" r="4"/></svg>';
  return el;
}

function drawRouteLayers(map, coordinates, theme) {
  const c = PALETTE[theme];
  const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates } };
  if (map.getSource('route')) {
    map.getSource('route').setData(geojson);
    return;
  }
  map.addSource('route', { type: 'geojson', data: geojson });
  map.addLayer({ id: 'route-halo', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.routeHalo, 'line-width': 9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.route, 'line-width': 4.5 } });
  map.addLayer({ id: 'route-dash', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.routeHalo, 'line-width': 4.5, 'line-dasharray': [0, 4, 3] } });
}

const DASH_SEQUENCE = (() => {
  const steps = [];
  for (let i = 0; i < 8; i++) steps.push([0, i * 0.4, 3, (8 - i) * 0.4]);
  return steps;
})();

function startDash(entry) {
  stopDash(entry);
  let i = 0;
  entry.dashTimer = setInterval(() => {
    if (!entry.map.getLayer('route-dash')) return;
    entry.map.setPaintProperty('route-dash', 'line-dasharray', DASH_SEQUENCE[i % DASH_SEQUENCE.length]);
    i++;
  }, 90);
}
function stopDash(entry) {
  if (entry.dashTimer) clearInterval(entry.dashTimer);
  entry.dashTimer = null;
}

// ===========================================================================
// Public API
// ===========================================================================
export function showOverview(containerId, center) {
  try {
    const entry = getOrCreate(containerId);
    const { map } = entry;
    const c = center || DEFAULT_CENTER;
    const apply = () => { map.resize(); map.jumpTo({ center: [c.lng, c.lat], zoom: 12.2 }); };
    if (map.loaded()) apply();
    else map.once('load', apply);
  } catch {
    demoMap(containerId, false);
  }
}

export function showRoute(containerId, origin, dest, coordinates, opts = {}) {
  if (!coordinates || !coordinates.length) return;
  try {
    const entry = getOrCreate(containerId);
    const { map } = entry;
    const theme = currentTheme();
    const render = () => {
      map.resize();
      drawRouteLayers(map, coordinates, theme);
      entry.hasRoute = true;
      if (!entry.markers.here) entry.markers.here = new maplibregl.Marker({ element: makeHereEl() }).setLngLat([origin.lng, origin.lat]).addTo(map);
      else entry.markers.here.setLngLat([origin.lng, origin.lat]);
      if (!entry.markers.dest) entry.markers.dest = new maplibregl.Marker({ element: makeDestEl(), anchor: 'bottom' }).setLngLat([dest.lng, dest.lat]).addTo(map);
      else entry.markers.dest.setLngLat([dest.lng, dest.lat]);
      const bounds = coordinates.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      // Pad to keep the route clear of the top bar and bottom sheet, but scale
      // down on short canvases so MapLibre can always satisfy the fit.
      const h = map.getCanvas().clientHeight || 600;
      const padTop = Math.min(90, h * 0.12);
      const padBottom = Math.min(h * 0.42, h - padTop - 60);
      try {
        map.fitBounds(bounds, { padding: { top: padTop, bottom: padBottom, left: 40, right: 40 }, maxZoom: 15, duration: 600 });
      } catch { /* bounds degenerate */ }
      if (opts.live) startDash(entry); else stopDash(entry);
    };
    if (map.isStyleLoaded()) render();
    else map.once('load', render);
  } catch {
    demoMap(containerId, true);
  }
}

export function updateUserLocation(containerId, lng, lat) {
  const entry = maps.get(containerId);
  if (entry?.markers?.here) entry.markers.here.setLngLat([lng, lat]);
}

// Show (or move) the live "you are here" marker on any map — used on the home
// overview. Optionally recentres the map on the user.
export function setUserMarker(containerId, lng, lat, center) {
  let entry;
  try { entry = getOrCreate(containerId); } catch { return; }
  const { map } = entry;
  // HTML markers don't need the style loaded, so add immediately.
  if (!entry.markers.user) {
    entry.markers.user = new maplibregl.Marker({ element: makeHereEl() }).setLngLat([lng, lat]).addTo(map);
  } else {
    entry.markers.user.setLngLat([lng, lat]);
  }
  if (center) map.easeTo({ center: [lng, lat], zoom: 14, duration: 700 });
}

export function refreshTheme() {
  document.querySelectorAll('.map').forEach((m) => (m.dataset.built = ''));
  const theme = currentTheme();
  maps.forEach((entry) => {
    const { map } = entry;
    const hadRoute = entry.hasRoute;
    const routeData = map.getSource('route')?._data;
    map.setStyle(monoStyle(theme));
    map.once('styledata', () => {
      if (hadRoute && routeData) {
        drawRouteLayers(map, routeData.geometry.coordinates, theme);
        if (entry.dashTimer) startDash(entry);
      }
    });
  });
}

// ===========================================================================
// Offline SVG fallback (illustrative)
// ===========================================================================
function demoMap(elId, withRoute) {
  const el = document.getElementById(elId);
  if (!el || el.dataset.built === (withRoute ? 'r' : 'p')) return;
  el.dataset.built = withRoute ? 'r' : 'p';
  const W = 440, H = 940;
  const seed = elId.length;
  const rnd = (n) => { const x = Math.sin(seed * 999 + n * 137.13) * 10000; return x - Math.floor(x); };
  let majors = '';
  majors += `<path d="M-20 120 Q ${W * 0.4} ${H * 0.3} ${W + 20} ${H * 0.55}" />`;
  majors += `<path d="M ${W * 0.2} -20 Q ${W * 0.5} ${H * 0.5} ${W * 0.35} ${H + 20}" />`;
  majors += `<path d="M-20 ${H * 0.78} Q ${W * 0.55} ${H * 0.7} ${W + 20} ${H * 0.85}" />`;
  let minors = '';
  for (let i = 0; i < 11; i++) { const y = (i / 10) * H; minors += `<path d="M-10 ${y + rnd(i) * 40 - 20} L ${W + 10} ${y + rnd(i + 5) * 40 - 20}"/>`; }
  for (let i = 0; i < 7; i++) { const x = (i / 6) * W; minors += `<path d="M${x + rnd(i) * 40 - 20} -10 L ${x + rnd(i + 3) * 40 - 20} ${H + 10}"/>`; }
  let blocks = '';
  for (let i = 0; i < 26; i++) { const x = rnd(i) * W, y = rnd(i + 30) * H, w = 24 + rnd(i + 9) * 52, h = 24 + rnd(i + 12) * 52; blocks += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`; }
  const water = `<path d="M-20 ${H * 0.18} C ${W * 0.3} ${H * 0.26}, ${W * 0.35} ${H * 0.12}, ${W * 0.6} ${H * 0.2} S ${W * 0.9} ${H * 0.34}, ${W + 20} ${H * 0.28} L ${W + 20} ${H * 0.4} C ${W * 0.8} ${H * 0.34}, ${W * 0.5} ${H * 0.46}, ${W * 0.2} ${H * 0.38} S -10 ${H * 0.34}, -20 ${H * 0.4} Z"/>`;
  let routeSvg = '';
  if (withRoute) {
    const d = `M ${W * 0.74} ${H * 0.66} C ${W * 0.5} ${H * 0.7}, ${W * 0.3} ${H * 0.66}, ${W * 0.24} ${H * 0.5} S ${W * 0.2} ${H * 0.3}, ${W * 0.34} ${H * 0.2}`;
    routeSvg = `
      <path class="route-halo" d="${d}" stroke-width="11"/>
      <path class="route-line" d="${d}" stroke-width="5"/>
      <path class="route-line route-dash" d="${d}" stroke-width="5" stroke="var(--route-halo)"/>
      <circle class="dot-here" cx="${W * 0.74}" cy="${H * 0.66}" r="18" fill="var(--route)"/>
      <circle cx="${W * 0.74}" cy="${H * 0.66}" r="8" fill="var(--route)"/>
      <circle cx="${W * 0.74}" cy="${H * 0.66}" r="4" fill="var(--route-halo)"/>
      <g class="pin-mark" transform="translate(${W * 0.34} ${H * 0.2})">
        <path d="M0 6 C 14 6 22 -4 22 -16 A 22 22 0 1 0 -22 -16 C -22 -4 -14 6 0 6 Z" fill="var(--route)" transform="translate(0,-2) scale(0.85)"/>
        <circle cx="0" cy="-15" r="6.5" fill="var(--route-halo)"/>
      </g>`;
  }
  const labels = withRoute
    ? `<text x="${W * 0.6}" y="${H * 0.34}">DESTINATION</text>`
    : `<text x="${W * 0.4}" y="${H * 0.5}">MAP OFFLINE</text>`;
  el.innerHTML = `
    <div class="grain"></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
      <rect width="${W}" height="${H}" fill="var(--map-land)"/>
      <g fill="var(--map-water)" stroke="none">${water}</g>
      <g fill="var(--map-block)" stroke="var(--map-land-2)" stroke-width="1">${blocks}</g>
      <g stroke="var(--map-road)" stroke-width="3" fill="none" stroke-linecap="round">${minors}</g>
      <g stroke="var(--map-road-mj)" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.9">${majors}</g>
      <g stroke="var(--map-road)" stroke-width="3.5" fill="none" stroke-linecap="round">${majors}</g>
      <g fill="var(--map-label)" font-family="Inter,sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" opacity="0.8">${labels}</g>
      ${routeSvg}
    </svg>`;
}
