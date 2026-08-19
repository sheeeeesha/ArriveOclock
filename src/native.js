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

// Resolve the platform robustly. getPlatform() reads the native bridge global
// the same way isNativePlatform() does, but also gives us the string ('android'
// /'ios'/'web') which we surface on the live screen for diagnosis.
export const platform = (() => {
  try { if (typeof Capacitor?.getPlatform === 'function') return Capacitor.getPlatform(); } catch { /* ignore */ }
  try { if (typeof window !== 'undefined' && window.Capacitor?.getPlatform) return window.Capacitor.getPlatform(); } catch { /* ignore */ }
  return 'web';
})();
export const isNative = platform === 'android' || platform === 'ios';

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
            // Surfaced as an in-app sheet by main.js. window.confirm() renders
            // as a bare Chrome dialog captioned with the localhost origin, which
            // reads as a scam prompt at the exact moment we ask for the app's
            // most sensitive permission.
            try {
              window.dispatchEvent(new CustomEvent('aoc:location-denied'));
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
// `sound` is an absolute path to the user's chosen song, or null for the
// bundled tone — the native side falls back on its own if it can't play it.
export async function fireNativeAlarm(title, body, sound = null, fadeIn = false) {
  if (!isNative) return;
  await ensureNotifPermission();
  try { alarmPlugin().set({ at: Date.now(), title, body, sound, fadeIn }); } catch { /* ignore */ }
}

// Schedule the native full-screen alarm for the predicted arrival time. This is
// the reliability backstop: AlarmManager (setAlarmClock) delivers it even if the
// WebView/JS is frozen, the app is killed, or the phone is in Doze — exactly when
// the live, fix-driven fire() can't run. The live engine reschedules this as GPS
// refines the ETA, and cancels it when it rings live.
export async function scheduleBackupAlarm(whenMs, title, body, sound = null, fadeIn = false) {
  if (!isNative) return;
  await ensureNotifPermission();
  try { alarmPlugin().set({ at: whenMs, title, body, sound, fadeIn }); } catch { /* ignore */ }
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

// ---------------------------------------------------------------------------
// Hardware / gesture back button.
//
// Without this, Android's back button closes the app from ANY screen — the
// clearest "unfinished app" tell there is, and mid-journey it loses the trip.
// @capacitor/app drives this through OnBackPressedDispatcher (the modern
// AndroidX API), so it keeps working on targetSdk 36 where Android 16 no longer
// dispatches KEYCODE_BACK, and it cooperates with predictive back.
// ---------------------------------------------------------------------------
export async function onHardwareBack(handler) {
  if (!isNative) return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('backButton', handler);
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  } catch {
    return () => {};
  }
}

// Close the app (only ever called from an explicit back-on-home confirmation).
export async function exitApp() {
  if (!isNative) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Alarm-reliability permissions. Every one of these fails with the SAME symptom
// — the alarm doesn't ring — so they are reported individually instead of
// leaving the user to guess which one broke.
// ---------------------------------------------------------------------------

// Everything true on web: there is nothing to grant there, and the permission
// panel should read as clean rather than throw five warnings at a browser user.
const ALL_OK = {
  fineLocation: true,
  backgroundLocation: true,
  notifications: true,
  batteryUnrestricted: true,
  exactAlarms: true,
};

export async function permissionStatus() {
  if (!isNative) return { ...ALL_OK, supported: false };
  try {
    const r = await alarmPlugin().permissions();
    return { ...ALL_OK, ...r, supported: true };
  } catch {
    // Older native build without the method — don't nag about what we can't read.
    return { ...ALL_OK, supported: false };
  }
}

// target: 'app' | 'notifications' | 'battery' | 'exactAlarm'
export async function openSetting(target = 'app') {
  if (!isNative) return false;
  try { await alarmPlugin().openSetting({ target }); return true; }
  catch { return openAppSettings(); }
}

// Foreground location + notifications only. Background location is deliberately
// NOT requested here: Android enforces incremental requests, and from 11 up
// "Allow all the time" is not offered in the dialog at all — it has to be set in
// Settings, which the permission panel walks the user to.
export async function requestBasePermissions() {
  if (!isNative) return;
  await ensureNotifPermission();
  try {
    if (!BG) BG = registerPlugin('BackgroundGeolocation');
    if (typeof BG.requestPermissions === 'function') await BG.requestPermissions();
  } catch { /* the watcher requests them too */ }
}

// ---------------------------------------------------------------------------
// Haptics. The app only used navigator.vibrate, which is a blunt buzz and does
// nothing on iOS. Capacitor's Haptics gives the OS-native taptic patterns, so
// a selection feels different from an impact.
// ---------------------------------------------------------------------------
let HAP = null;
async function haptics() {
  if (!isNative) return null;
  if (!HAP) {
    try { HAP = await import('@capacitor/haptics'); } catch { return null; }
  }
  return HAP;
}

// A light tick for picking something from a list.
export async function tapSelection() {
  const h = await haptics();
  try { await h?.Haptics.selectionChanged(); } catch { /* ignore */ }
}

// A firmer bump for committing to something (starting or ending a journey).
export async function tapImpact(style = 'medium') {
  const h = await haptics();
  if (!h) return;
  try {
    const map = { light: h.ImpactStyle.Light, medium: h.ImpactStyle.Medium, heavy: h.ImpactStyle.Heavy };
    await h.Haptics.impact({ style: map[style] || h.ImpactStyle.Medium });
  } catch { /* ignore */ }
}

// Success / warning / error patterns, used for outcomes rather than taps.
export async function tapNotify(kind = 'SUCCESS') {
  const h = await haptics();
  if (!h) return;
  try { await h.Haptics.notification({ type: h.NotificationType[kind] || h.NotificationType.Success }); }
  catch { /* ignore */ }
}
