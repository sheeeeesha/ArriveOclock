import { Capacitor, registerPlugin } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Native bridge (Capacitor). On the web this is all no-ops — isNative is false
// and the plugins are never touched, so the web build/runtime is unchanged.
//
// On Android (and later iOS) it provides what the browser can't:
//   • background location via a foreground-service watcher (keeps tracking when
//     the screen is off / app backgrounded), feeding the SAME motion-based
//     alarm engine in alarm.js,
//   • a local notification that fires the alarm even when backgrounded.
// ---------------------------------------------------------------------------

export const isNative = Capacitor.isNativePlatform();

let BG = null; // @capacitor-community/background-geolocation
let LN = null; // @capacitor/local-notifications
let watcherId = null;

async function ensure() {
  if (!isNative) return false;
  if (!BG) BG = registerPlugin('BackgroundGeolocation');
  if (!LN) {
    const mod = await import('@capacitor/local-notifications');
    LN = mod.LocalNotifications;
    try { await LN.requestPermissions(); } catch { /* ignore */ }
    try {
      if (LN.createChannel) {
        await LN.createChannel({ id: 'alarm', name: 'Arrival alarm', description: 'Wakes you near your stop', importance: 5, vibration: true });
      }
    } catch { /* ignore */ }
  }
  return true;
}

// Start continuous background tracking. onLoc receives { lng, lat, speed, ts }
// on every fix — even with the screen off — via the plugin's foreground service.
export async function startBackgroundTracking(onLoc) {
  if (!(await ensure())) return;
  await stopBackgroundTracking();
  try {
    watcherId = await BG.addWatcher(
      {
        backgroundTitle: "ArriveO'Clock — trip in progress",
        backgroundMessage: "Tracking your location so we can wake you near your stop.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 20,
      },
      (location, error) => {
        if (error || !location) return;
        onLoc({ lng: location.longitude, lat: location.latitude, speed: location.speed, ts: Date.now() });
      }
    );
  } catch {
    watcherId = null;
  }
}

export async function stopBackgroundTracking() {
  if (watcherId && BG) {
    try { await BG.removeWatcher({ id: watcherId }); } catch { /* ignore */ }
    watcherId = null;
  }
}

// Fire a local notification — shows + sounds even when the app is backgrounded.
export async function fireNativeAlarm(title, body) {
  if (!(await ensure())) return;
  try {
    await LN.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 100000),
        title,
        body,
        channelId: 'alarm',
        schedule: { at: new Date(Date.now() + 250) },
      }],
    });
  } catch { /* ignore */ }
}
