# ArriveO'Clock — Android (Capacitor) build guide

The app is wrapped with **Capacitor** so it can do what a browser can't:
**background location** (track with the screen off) + a **local notification**
that fires the alarm even when backgrounded. The same web code runs inside a
native Android shell — `src/native.js` bridges to the plugins, and everything
is a no-op on the web build.

> ⚠️ This native layer has **not been device-tested yet** — it's the working
> foundation. Background location is inherently device/OEM-specific, so expect
> to iterate on a real phone (permission flow, battery settings, OEM killers).

---

## Prerequisites
- **Node** (already used for the web app).
- **Android Studio** + Android SDK (Giraffe/Koala or newer). Install from
  developer.android.com/studio. On first launch let it install the SDK + an
  emulator if you want one.
- A **real Android phone** with **USB debugging** on (Settings → Developer
  options) — strongly preferred over the emulator for testing background GPS.
- (Only if publishing later) a **Google Play Developer account** ($25 one-time)
  and a background-location **policy declaration**. Not needed to sideload to
  your own phone.

No Mac needed — this is Android-only.

---

## One-time setup
From the project root:

```bash
npm install                 # ensure deps (incl. @capacitor/*) are present
npm run build               # produce dist/ (Capacitor copies this in)
npx cap add android         # generates the native android/ project
npx cap sync                # copies web build + native plugins into android/
```

### Add the Android permissions
Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`
(above `<application>`):

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

(The `@capacitor-community/background-geolocation` plugin registers its own
foreground service; you only need the permissions above. Check the plugin's
README for the exact current requirements for your plugin version.)

---

## Build & run on your phone
```bash
npx cap open android        # opens the project in Android Studio
```
Then in Android Studio: pick your connected device → **Run ▶**. It installs and
launches the app.

When you start a journey it will ask for **location** (choose **Allow all the
time** / grant "Allow all the time" in Settings if prompted) and **notifications**.

After any web code change, repeat:
```bash
npm run build && npx cap sync
```

---

## How to test the background alarm
1. Start a journey to a nearby destination (or mock movement — Android Studio →
   **Extended controls → Location** lets you set/route GPS for the emulator; on
   a real phone, actually move or use a mock-location dev app).
2. You should see a persistent **"trip in progress"** foreground-service
   notification — that's what keeps tracking alive.
3. **Lock the phone / switch apps.** Tracking continues.
4. As you approach the stop (live ETA ≤ your lead time), a **"Almost there"**
   notification fires with sound — even with the screen off.

### If it doesn't fire in the background
- **Battery optimization:** Settings → Apps → ArriveO'Clock → Battery →
  **Unrestricted** (OEMs like Xiaomi/Samsung/OnePlus kill background apps; see
  dontkillmyapp.com for per-brand steps).
- Confirm location is **"Allow all the time,"** not just "While using."
- Confirm **notifications** are allowed (Android 13+).

---

## Notes
- `appId` is `com.arriveoclock.app` (in `capacitor.config.json`) — change it
  before publishing to Play if needed; it must be globally unique there.
- Everything in `src/` still runs as the web app too — `isNative` gates the
  native bits, so `npm run dev` / the Vercel site are unaffected.
- iOS later: `npx cap add ios` (needs a Mac + Xcode + Apple Developer account);
  the same `src/native.js` bridge works, but background location needs the
  "Always" permission + App Store review.
