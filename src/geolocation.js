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
