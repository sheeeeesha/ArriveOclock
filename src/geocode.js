import { GEOCODER_URL, DEFAULT_CENTER } from './config.js';

// ---------------------------------------------------------------------------
// Forward + reverse geocoding via Photon (Komoot) — a free, keyless, global
// OpenStreetMap geocoder with good type-ahead. Falls back to a tiny static
// list only if the network is unavailable.
// ---------------------------------------------------------------------------

const FALLBACK = [
  { name: 'City Centre', address: '', lng: DEFAULT_CENTER.lng, lat: DEFAULT_CENTER.lat },
];

let debounceTimer = null;

function label(props) {
  // Build a readable secondary line from whatever OSM fields exist.
  const parts = [props.street, props.district, props.city || props.town || props.village, props.state, props.country];
  return parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');
}

function mapFeature(f) {
  const p = f.properties || {};
  const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || 'Unnamed place';
  return { name, address: label(p), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
}

export function searchPlaces(query, near) {
  query = (query || '').trim();
  if (query.length < 2) return Promise.resolve([]);
  const bias = near || DEFAULT_CENTER;
  const url =
    `${GEOCODER_URL}/api/?q=${encodeURIComponent(query)}` +
    `&limit=6&lang=en&lat=${bias.lat}&lon=${bias.lng}`;
  return fetch(url)
    .then((r) => r.json())
    .then((j) => (j.features || []).map(mapFeature))
    .catch(() => FALLBACK);
}

export function searchPlacesDebounced(query, cb, delay = 280) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => searchPlaces(query).then(cb), delay);
}

// Reverse-geocode a coordinate to a short place label (for "Your location").
export function reverseGeocode(lng, lat) {
  const url = `${GEOCODER_URL}/reverse/?lat=${lat}&lon=${lng}&lang=en`;
  return fetch(url)
    .then((r) => r.json())
    .then((j) => {
      const f = (j.features || [])[0];
      if (!f) return null;
      const p = f.properties || {};
      return p.city || p.town || p.village || p.suburb || p.name || p.state || null;
    })
    .catch(() => null);
}
