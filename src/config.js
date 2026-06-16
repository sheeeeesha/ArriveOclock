// ---------------------------------------------------------------------------
// Central configuration.
//
// ArriveO'Clock runs FULLY FREE with no API keys: maps (MapLibre +
// OpenFreeMap), search (Photon), driving routes (OSRM) and the motion-based
// alarm are all keyless and global. Supabase is the only optional service,
// and only for cross-device login/sync — without it the app runs in local
// (demo) mode using localStorage.
// ---------------------------------------------------------------------------

const env = import.meta.env;

export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// When Supabase isn't configured we keep data in localStorage and don't gate
// the app behind a login screen.
export const DEMO = !hasSupabase;

// --- Free, keyless service endpoints (overridable via env if you self-host) -
export const TILES_STYLE_SOURCE = 'https://tiles.openfreemap.org/planet';
export const TILES_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const GEOCODER_URL = env.VITE_GEOCODER_URL || 'https://photon.komoot.io';
export const OSRM_URL = env.VITE_OSRM_URL || 'https://router.project-osrm.org';

// Default centre before we have the user's real location (Pune, IN — but the
// app is global; this is only a first-paint fallback).
export const DEFAULT_CENTER = { lng: 73.8567, lat: 18.5204 };

export function logConfig() {
  // eslint-disable-next-line no-console
  console.info(
    `[ArriveO'Clock] free+global · supabase=${hasSupabase ? 'live' : 'local'} ` +
      `· maps=openfreemap · search=photon · driving=osrm · transit via /api/route`
  );
}
