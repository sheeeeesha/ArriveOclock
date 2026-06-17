import { OSRM_URL } from './config.js';
import { MODES } from './state.js';

// ---------------------------------------------------------------------------
// Public-transit routing + ETA for the planning screen.
//
//   - Accurate path: /api/route → Google Directions transit (when a Google key
//     is configured) returns the REAL duration, distance and route line that
//     match Google Maps; or Transitous/MOTIS where an open feed exists.
//   - Free fallback: OSRM gives the real road distance (shown as-is, no longer
//     inflated by a per-mode factor); the duration is estimated from a typical
//     per-mode speed + access/wait overhead (clearly an estimate).
//
// The live ALARM doesn't depend on any of this — it tracks real GPS motion.
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

// Estimate when no real transit data is available. Distance shown is the real
// road distance; only the duration is modelled (detour factor + speed + wait).
function estimate(modeKey, baseM) {
  const m = MODES[modeKey] || MODES.bus;
  const duration_s = ((baseM / 1000) * (m.factor || 1) / (m.kmh || 25)) * 3600 + (m.overheadMin || 0) * 60;
  return { distance_m: baseM, duration_s };
}

// Real road distance + geometry from OSRM (offline/failure → straight estimate).
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

// Real transit data via the backend (Google / Transitous). null if unavailable.
async function transitETA(origin, dest, mode) {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, dest, mode }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (d && d.duration_s) {
      return {
        duration_s: d.duration_s,
        distance_m: d.distance_m || null,
        coordinates: Array.isArray(d.coordinates) && d.coordinates.length ? d.coordinates : null,
        summary: d.summary || '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function transitResult(origin, dest, mode, base) {
  const real = await transitETA(origin, dest, mode);
  if (real) {
    return {
      distance_m: real.distance_m || base.m,
      duration_s: real.duration_s,
      coordinates: real.coordinates || base.coords,
      summary: real.summary,
    };
  }
  const est = estimate(mode, base.m);
  return { ...est, coordinates: base.coords, summary: '' };
}

// Single mode.
export async function getRoute(origin, dest, modeKey) {
  if (!origin || !dest) return null;
  const base = await roadBase(origin, dest);
  return transitResult(origin, dest, modeKey || 'bus', base);
}

// All public-transit modes — one OSRM base call, transit overlaid per mode.
export async function getAllModes(origin, dest) {
  if (!origin || !dest) return {};
  const base = await roadBase(origin, dest);
  const out = {};
  await Promise.all(
    Object.keys(MODES).map(async (k) => {
      out[k] = await transitResult(origin, dest, k, base);
    })
  );
  return out;
}

export { haversine };
