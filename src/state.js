// ---------------------------------------------------------------------------
// App-wide mutable state. Kept deliberately small and explicit.
// ---------------------------------------------------------------------------

export const state = {
  // auth
  user: null, // { id, email, name, avatar }
  profile: null, // row from `profiles`

  // data
  recents: [],
  saved: [],

  // routing
  origin: null, // { name, address, lng, lat }
  dest: null, // { name, address, lng, lat }
  mode: 'car', // car | bus | metro | train
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
// For transit modes (no live feed), ETA is estimated from the road distance:
//   duration = distance * factor / avg-speed  +  fixed access/wait overhead.
// `factor` adjusts route directness vs roads; `overheadMin` covers walking to
// the stop, waiting, and transfers. Tuned to be realistic, not optimistic.
export const MODES = {
  car: { profile: 'driving-traffic', label: 'Car' },
  bus: { profile: 'driving', label: 'Bus', factor: 1.15, kmh: 20, overheadMin: 6 },
  metro: { profile: 'driving', label: 'Metro', factor: 0.9, kmh: 33, overheadMin: 7 },
  train: { profile: 'driving', label: 'Train', factor: 1.0, kmh: 46, overheadMin: 10 },
};
