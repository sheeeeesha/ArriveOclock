// ---------------------------------------------------------------------------
// Vercel serverless function: free public-transit ETA proxy.
//
// Mapbox/OSRM can't route public transit, so bus/metro/train durations come
// from MOTIS via Transitous (https://transitous.org) — a free, community-run,
// keyless transit router that aggregates open GTFS feeds worldwide. Coverage
// depends on which feeds a city has published; where there's none, this
// returns `no_route` and the client falls back to a distance estimate.
//
// The route line itself is drawn from OSRM on the client; here we only return
// the real transit DURATION (+ a "via <lines>" summary).
//
// Override the endpoint with env TRANSIT_API if you self-host MOTIS/OTP.
//
// Request  (POST JSON): { origin:{lng,lat}, dest:{lng,lat}, mode }
// Response (JSON)     : { duration_s, summary, provider } | { error }
// ---------------------------------------------------------------------------

const TRANSIT_API = process.env.TRANSIT_API || 'https://api.transitous.org';

const MODE_MAP = { bus: 'BUS', metro: 'SUBWAY', train: 'RAIL' };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const { origin, dest } = body;
  if (!origin || !dest) { res.status(400).json({ error: 'missing_points' }); return; }
  const transitMode = MODE_MAP[body.mode];
  if (!transitMode) { res.status(200).json({ error: 'not_transit' }); return; }

  const params = new URLSearchParams({
    fromPlace: `${origin.lat},${origin.lng}`,
    toPlace: `${dest.lat},${dest.lng}`,
    arriveBy: 'false',
    transitModes: transitMode,
    numItineraries: '1',
  });

  try {
    const r = await fetch(`${TRANSIT_API}/api/v1/plan?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) { res.status(200).json({ error: 'no_route', status: r.status }); return; }
    const json = await r.json();
    const it = (json.itineraries || json.plan?.itineraries || [])[0];
    if (!it) { res.status(200).json({ error: 'no_route' }); return; }

    // MOTIS v3 returns duration in seconds.
    const duration_s = it.duration || 0;
    const lines = (it.legs || [])
      .filter((l) => l.mode && l.mode !== 'WALK' && (l.routeShortName || l.routeLongName || l.headsign))
      .map((l) => l.routeShortName || l.routeLongName || l.headsign)
      .filter(Boolean);
    const summary = lines.length ? 'via ' + lines.join(' → ') : '';

    if (!duration_s) { res.status(200).json({ error: 'no_route' }); return; }
    res.status(200).json({ duration_s, summary, provider: 'transitous' });
  } catch (e) {
    res.status(200).json({ error: 'transit_unreachable', detail: String(e) });
  }
}
