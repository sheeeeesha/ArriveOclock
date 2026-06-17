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
        await LN.createChannel({
          id: 'alarm',
          name: 'Arrival alarm',
          description: 'Wakes you near your stop',
          importance: 5,        // MAX — heads-up + sound even when locked
          visibility: 1,        // PUBLIC — show full alarm on the lock screen
          sound: 'alarm.wav',   // loud tone from res/raw, not the default chime
          vibration: true,
        });
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
        if (error) {
          // Android 11+ deliberately hides "Allow all the time" from the first
          // prompt — the user can only pick "While using" there. Background
          // access must be flipped on in Settings; route them there.
          if (error.code === 'NOT_AUTHORIZED') {
            try {
              const ok = window.confirm(
                'To wake you with the screen locked, ArriveO’Clock needs location set to “Allow all the time”.\n\n' +
                'Android hides that option from the popup — open Settings to switch it on now?'
              );
              if (ok) BG.openSettings();
            } catch { /* ignore */ }
          }
          return;
        }
        if (!location) return;
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

// Fire a local notification NOW — shows + sounds even when backgrounded.
export async function fireNativeAlarm(title, body) {
  if (!(await ensure())) return;
  try {
    await cancelBackupAlarm();        // we're ringing live; drop the scheduled backup
    await LN.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 100000),
        title,
        body,
        channelId: 'alarm',
        sound: 'alarm.wav',           // pre-Android-O fallback; O+ uses the channel sound
        schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
      }],
    });
  } catch { /* ignore */ }
}

// Fixed id so re-scheduling REPLACES the pending backup instead of stacking.
const BACKUP_ID = 424242;

// Schedule an OS-level alarm for the predicted arrival time. This is the
// reliability backstop: AlarmManager (allowWhileIdle) delivers it even if the
// WebView/JS is frozen, the app is killed, or the phone is in Doze — the exact
// situations where the live, fix-driven fire() can't run. The live engine
// reschedules this as GPS refines the ETA, and cancels it when it rings live.
export async function scheduleBackupAlarm(whenMs, title, body) {
  if (!(await ensure())) return;
  // Already due (e.g. a stop closer than the lead time) → just ring now.
  if (whenMs <= Date.now() + 1500) { await fireNativeAlarm(title, body); return; }
  try {
    await cancelBackupAlarm();
    await LN.schedule({
      notifications: [{
        id: BACKUP_ID,
        title,
        body,
        channelId: 'alarm',
        sound: 'alarm.wav',
        schedule: { at: new Date(whenMs), allowWhileIdle: true },
      }],
    });
  } catch { /* ignore */ }
}

export async function cancelBackupAlarm() {
  if (!LN) return;
  try { await LN.cancel({ notifications: [{ id: BACKUP_ID }] }); } catch { /* ignore */ }
}
