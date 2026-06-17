// ---------------------------------------------------------------------------
// Vercel serverless function: public-transit ETA + distance + route line.
//
// Accuracy tiers (first available wins):
//   1. GOOGLE_MAPS_API_KEY set → Google Directions in transit mode. Returns the
//      same duration/distance Google Maps shows, plus the real route polyline.
//      (Enable "Directions API" in Google Cloud. Free monthly credit covers
//      typical personal usage.)
//   2. TRANSIT_API set (default Transitous/MOTIS) → free community transit
//      routing; duration + line names where an open GTFS feed exists.
//   3. Neither/none found → 501 or no_route; the client falls back to a
//      distance-based estimate.
//
// Request  (POST JSON): { origin:{lng,lat}, dest:{lng,lat}, mode }
// Response (JSON)     : { duration_s, distance_m?, coordinates?, summary, provider }
//                       | { error }
// ---------------------------------------------------------------------------

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const TRANSIT_API = process.env.TRANSIT_API || 'https://api.transitous.org';

const GOOGLE_MODE = { bus: 'bus', metro: 'subway', train: 'rail' };
const MOTIS_MODE = { bus: 'BUS', metro: 'SUBWAY', train: 'RAIL' };

// Decode a Google encoded polyline → [[lng,lat], ...].
function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

async function viaGoogle(origin, dest, mode) {
  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
    mode: 'transit',
    transit_mode: GOOGLE_MODE[mode] || 'bus',
    departure_time: 'now',
    key: GOOGLE_KEY,
  });
  const json = await (await fetch('https://maps.googleapis.com/maps/api/directions/json?' + params)).json();
  if (json.status !== 'OK' || !json.routes?.length) return { error: 'no_route', status: json.status };
  const route = json.routes[0];
  const leg = route.legs[0];
  const lines = (leg.steps || [])
    .filter((s) => s.travel_mode === 'TRANSIT' && s.transit_details?.line)
    .map((s) => s.transit_details.line.short_name || s.transit_details.line.name)
    .filter(Boolean);
  return {
    duration_s: leg.duration?.value || 0,
    distance_m: leg.distance?.value || null,
    coordinates: route.overview_polyline?.points ? decodePolyline(route.overview_polyline.points) : null,
    summary: lines.length ? 'via ' + lines.join(' → ') : '',
    provider: 'google',
  };
}

async function viaTransitous(origin, dest, mode) {
  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lng}`,
    toPlace: `${dest.lat},${dest.lng}`,
    arriveBy: 'false',
    transitModes: MOTIS_MODE[mode] || 'BUS',
    numItineraries: '1',
  });
  const r = await fetch(`${TRANSIT_API}/api/v1/plan?${params}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return { error: 'no_route', status: r.status };
  const json = await r.json();
  const it = (json.itineraries || json.plan?.itineraries || [])[0];
  if (!it || !it.duration) return { error: 'no_route' };
  const lines = (it.legs || [])
    .filter((l) => l.mode && l.mode !== 'WALK' && (l.routeShortName || l.routeLongName || l.headsign))
    .map((l) => l.routeShortName || l.routeLongName || l.headsign)
    .filter(Boolean);
  return { duration_s: it.duration, summary: lines.length ? 'via ' + lines.join(' → ') : '', provider: 'transitous' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { origin, dest } = body;
  const valid = (p) =>
    p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  if (!valid(origin) || !valid(dest)) { res.status(400).json({ error: 'bad_points' }); return; }
  const mode = GOOGLE_MODE[body.mode] ? body.mode : null;
  if (!mode) { res.status(200).json({ error: 'not_transit' }); return; }

  try {
    const out = GOOGLE_KEY ? await viaGoogle(origin, dest, mode) : await viaTransitous(origin, dest, mode);
    res.status(out && out.duration_s ? 200 : 200).json(out);
  } catch (e) {
    res.status(200).json({ error: 'routing_unreachable', detail: String(e) });
  }
}
