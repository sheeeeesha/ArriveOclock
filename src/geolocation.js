import { DEFAULT_CENTER } from './config.js';

// ---------------------------------------------------------------------------
// Geolocation wrappers. We deliberately favour ONE-SHOT fixes over a continuous
// watchPosition() stream — a constant high-accuracy watch is the single biggest
// battery drain, and the alarm engine instead samples adaptively (see alarm.js)
// so GPS is idle between checks.
// ---------------------------------------------------------------------------

export function getCurrentPosition(highAccuracy = true) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...DEFAULT_CENTER, fallback: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed, // m/s or null
          ts: pos.timestamp,
        }),
      () => resolve({ ...DEFAULT_CENTER, fallback: true }),
      { enableHighAccuracy: highAccuracy, timeout: 9000, maximumAge: highAccuracy ? 5000 : 30000 }
    );
  });
}

export function geolocationAvailable() {
  return 'geolocation' in navigator;
}

// Continuous high-frequency tracking — used only near the destination so a stop
// is detected within a second or two (the spaced one-shot fixes elsewhere keep
// battery use low). cb receives the same shape as getCurrentPosition, or
// { fallback: true } on error. Returns a stop() function.
export function watchPosition(cb, highAccuracy = true) {
  if (!('geolocation' in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      cb({
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        ts: pos.timestamp,
      }),
    () => cb({ fallback: true }),
    { enableHighAccuracy: highAccuracy, maximumAge: 2000, timeout: 15000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}
