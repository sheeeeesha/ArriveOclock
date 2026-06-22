import { Capacitor, registerPlugin } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Native bridge (Capacitor). On the web this is all no-ops — isNative is false
// and the plugins are never touched, so the web build/runtime is unchanged.
//
// On Android (and later iOS) it provides what the browser can't:
//   • background location via a foreground-service watcher (keeps tracking when
//     the screen is off / app backgrounded), feeding the SAME motion-based
//     alarm engine in alarm.js,
//   • a NATIVE full-screen alarm (custom "Alarm" plugin) that fires via
//     AlarmManager and rings on the ALARM stream over the lock screen — even if
//     the app is killed or the phone is in Doze. A plain notification can't do
//     that (it plays on the notification stream and can't go full-screen).
// ---------------------------------------------------------------------------

export const isNative = Capacitor.isNativePlatform();

let BG = null;    // @capacitor-community/background-geolocation
let LN = null;    // @capacitor/local-notifications (used only to request notif permission)
let ALARM = null; // our native Alarm plugin (see android .../AlarmPlugin.java)
let watcherId = null;

// Notification permission is needed (Android 13+) both for the foreground-service
// tracking notification and for the alarm's full-screen-intent notification.
async function ensureNotifPermission() {
  if (!isNative) return;
  if (!LN) {
    try { const mod = await import('@capacitor/local-notifications'); LN = mod.LocalNotifications; }
    catch { return; }
  }
  try { await LN.requestPermissions(); } catch { /* ignore */ }
}

function alarmPlugin() {
  if (!ALARM) ALARM = registerPlugin('Alarm');
  return ALARM;
}

// Start continuous background tracking. onLoc receives { lng, lat, speed, ts }
// on every fix — even with the screen off — via the plugin's foreground service.
export async function startBackgroundTracking(onLoc) {
  if (!isNative) return;
  if (!BG) BG = registerPlugin('BackgroundGeolocation');
  await ensureNotifPermission();
  await stopBackgroundTracking();
  try {
    watcherId = await BG.addWatcher(
      {
        backgroundTitle: "ArriveO'Clock — journey in progress",
        backgroundMessage: "Tracking your stop · tap to open. Stays until you end the trip.",
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

// Ring the native full-screen alarm NOW (rings even when backgrounded; the
// AlarmActivity launches over the app and plays on the alarm stream).
export async function fireNativeAlarm(title, body) {
  if (!isNative) return;
  await ensureNotifPermission();
  try { alarmPlugin().set({ at: Date.now(), title, body }); } catch { /* ignore */ }
}

// Schedule the native full-screen alarm for the predicted arrival time. This is
// the reliability backstop: AlarmManager (setAlarmClock) delivers it even if the
// WebView/JS is frozen, the app is killed, or the phone is in Doze — exactly when
// the live, fix-driven fire() can't run. The live engine reschedules this as GPS
// refines the ETA, and cancels it when it rings live.
export async function scheduleBackupAlarm(whenMs, title, body) {
  if (!isNative) return;
  await ensureNotifPermission();
  try { alarmPlugin().set({ at: whenMs, title, body }); } catch { /* ignore */ }
}

// Cancel the pending alarm AND stop any active ringing.
export async function cancelBackupAlarm() {
  if (!isNative) return;
  try { alarmPlugin().cancel(); } catch { /* ignore */ }
}

// Open this app's settings page (Permissions / Notifications), where the user
// can set location to "Allow all the time" and manage notifications. Returns
// false on web (no native settings to open).
export async function openAppSettings() {
  if (!isNative) return false;
  if (!BG) BG = registerPlugin('BackgroundGeolocation');
  try { await BG.openSettings(); return true; } catch { return false; }
}
