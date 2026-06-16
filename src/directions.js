import { OSRM_URL } from './config.js';
import { MODES } from './state.js';

// ---------------------------------------------------------------------------
// Routing + ETA for the PLANNING screen, all free / keyless:
//
//   - Road geometry + driving ETA: OSRM (global, no key).
//   - Real transit durations (bus/metro/train): /api/route → Transitous/MOTIS,
//     overlaid on the OSRM road line; where no feed exists, a distance estimate
//     is used (typical per-mode speed + dwell factor, see MODES in state.js).
//
// The live ALARM does NOT depend on any of this — it tracks your real GPS
// motion (alarm.js), so it's accurate on any mode, anywhere, even offline.
// ---------------------------------------------------------------------------

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function demoGeometry(origin, dest) {
  const mid = {
    lng: (origin.lng + dest.lng) / 2 + (dest.lat - origin.lat) * 0.12,
    lat: (origin.lat + dest.lat) / 2 - (dest.lng - origin.lng) * 0.12,
  };
  const coords = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const x = (1 - t) ** 2 * origin.lng + 2 * (1 - t) * t * mid.lng + t ** 2 * dest.lng;
    const y = (1 - t) ** 2 * origin.lat + 2 * (1 - t) * t * mid.lat + t ** 2 * dest.lat;
    coords.push([x, y]);
  }
  return coords;
}

function estimate(modeKey, baseM, baseS) {
  const m = MODES[modeKey] || MODES.car;
  if (modeKey === 'car') return { distance_m: baseM, duration_s: baseS };
  const distance_m = baseM * (m.factor || 1);
  // in-vehicle time at the mode's average speed + fixed access/wait overhead
  const duration_s = (distance_m / 1000 / (m.kmh || 30)) * 3600 + (m.overheadMin || 0) * 60;
  return { distance_m, duration_s };
}

// Road geometry + driving distance/duration (OSRM, with offline fallback).
async function roadBase(origin, dest) {
  try {
    const url =
      `${OSRM_URL}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson`;
    const json = await (await fetch(url)).json();
    const r = json.routes && json.routes[0];
    if (!r) throw new Error('no route');
    return { m: r.distance, s: r.duration, coords: r.geometry.coordinates };
  } catch {
    const coords = demoGeometry(origin, dest);
    const m = haversine(origin, dest) * 1.35;
    return { m, s: (m / 1000 / 30) * 3600, coords };
  }
}

// Real transit duration via the backend (null if unavailable / no feed).
async function transitETA(origin, dest, mode) {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, dest, mode }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d && d.duration_s) return { duration_s: d.duration_s, summary: d.summary || '' };
    return null;
  } catch {
    return null;
  }
}

function carResult(base) {
  return { distance_m: base.m, duration_s: base.s, coordinates: base.coords, summary: '' };
}
async function transitResult(origin, dest, mode, base) {
  const real = await transitETA(origin, dest, mode);
  if (real) return { distance_m: base.m, duration_s: real.duration_s, coordinates: base.coords, summary: real.summary };
  const est = estimate(mode, base.m, base.s);
  return { ...est, coordinates: base.coords, summary: '' };
}

// Single mode (kept for completeness).
export async function getRoute(origin, dest, modeKey) {
  if (!origin || !dest) return null;
  const base = await roadBase(origin, dest);
  if (modeKey === 'car') return carResult(base);
  return transitResult(origin, dest, modeKey, base);
}

// All modes — one OSRM call, transit overlaid per mode.
export async function getAllModes(origin, dest) {
  if (!origin || !dest) return {};
  const base = await roadBase(origin, dest);
  const out = { car: carResult(base) };
  await Promise.all(
    ['bus', 'metro', 'train'].map(async (k) => {
      out[k] = await transitResult(origin, dest, k, base);
    })
  );
  return out;
}

export { haversine };
