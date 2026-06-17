// ---------------------------------------------------------------------------
// App-wide mutable state. Kept deliberately small and explicit.
// ---------------------------------------------------------------------------

export const state = {
  // auth
  user: null, // { id, email, name, avatar }
  profile: null, // row from `profiles`
  guest: false, // using the app locally without an account

  // data
  recents: [],
  saved: [],

  // routing
  origin: null, // { name, address, lng, lat }
  dest: null, // { name, address, lng, lat }
  mode: 'transit', // single generic public-transport mode (no picker)
  routes: {}, // mode -> { distance_m, duration_s, coordinates, summary }
  routeSummary: '', // human label for the active route, e.g. "via Metro Line 1"

  // journey
  journeyId: null,
  journeyActive: false,
  live: null, // { totalMin, totalKm, leftMin, leftKm, eta, alarmMin }

  // preferences
  leadTimeMin: 5,
  tone: 'Lo-fi',
  vibrate: true,
  units: 'km',

  // ui
  navStack: [],
  pickTarget: null, // 'origin' | 'dest' | 'editLocation' | null — what search is choosing for
  editing: null, // working copy of a saved place being added/edited
};

// Unit helpers honouring state.units ('km' | 'mi').
export function distUnit() { return state.units === 'mi' ? 'mi' : 'km'; }
export function distVal(meters) { return state.units === 'mi' ? meters / 1609.344 : meters / 1000; }
export function distFromKm(km) { return state.units === 'mi' ? km * 0.621371 : km; }
export function speedUnit() { return state.units === 'mi' ? 'mph' : 'km/h'; }
export function speedFromKmh(kmh) { return state.units === 'mi' ? kmh * 0.621371 : kmh; }

// Built-in alarm sounds — all synthesised with the Web Audio API in sound.js,
// so there are zero binary audio assets to ship and they work offline.
export const TONES = [
  'Lo-fi',
  'Sunrise',
  'Marimba',
  'Soft Chime',
  'Beacon',
  'Digital',
  'Radar',
  'Uplift',
  'Pulse',
  'Classic Bell',
];

// Transport modes → Mapbox Directions profile (+ how we model transit, which
// Mapbox does not route natively — see directions.js).
// For transit modes (no live feed), ETA is estimated from the REAL OSRM road
// duration, lightly slowed for transit stops, plus a distance-scaled access/
// wait overhead (see directions.js). `factor` = transit slowdown on road time;
// `kmh` = fallback speed if OSRM gives nothing; `overheadMin` = the CAP on the
// access/wait penalty (a short hop carries far less than a long ride).
// Single generic public-transport profile (the mode picker was removed since
// it never affected the alarm). Used only for the keyless ETA estimate.
export const MODES = {
  transit: { label: 'Transit', factor: 1.15, kmh: 24, overheadMin: 5 },
};
