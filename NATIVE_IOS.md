# ArriveO'Clock iOS — native build & alarm

The iOS app is the same web app (Vite build) wrapped in Capacitor, sharing all
JS logic with Android — the motion-based alarm engine, the map, auth, and DB are
identical. Only the *native* pieces differ, because iOS has no equivalent of
Android's full-screen-intent alarm. This doc covers how iOS rings, how to build
it, and the Apple-account requirements you can't get around.

## What ships in the iOS target
- **`ios/App/App/AlarmPlugin.swift`** — the native "Alarm" Capacitor plugin,
  exposing the *same* JS contract as Android (`Alarm.set({at,title,body})`,
  `Alarm.cancel()`, `Alarm.stop()`), so `src/native.js` needs no per-platform
  code — `registerPlugin('Alarm')` resolves to this on iOS.
- **`ios/App/App/alarm.wav`** — the alarm tone, bundled so it can be used both as
  a looping `AVAudioPlayer` sound and as a custom notification sound.
- **`ios/App/App/App.entitlements`** — enables **time-sensitive** notifications
  (they break through Focus / Do-Not-Disturb).
- **`ios/App/App/Info.plist`** — location usage strings, `UIBackgroundModes`
  (`location` + `audio`), and the `com.arriveoclock.app` URL scheme for the
  Google-OAuth deep-link return.

## How the alarm rings on iOS
iOS has no AlarmManager and no full-screen intent, so there is no single
mechanism that guarantees a ring from a killed app. `AlarmPlugin.swift` uses two
layers:

1. **Live ring** (`at <= now`, i.e. the JS engine detected arrival while the app
   is alive — foreground or kept awake by background location): loop `alarm.wav`
   via `AVAudioPlayer` on a **`.playback`** audio session. That category ignores
   the mute switch and, with the `audio` background mode, keeps sounding with the
   screen locked. A time-sensitive notification is posted alongside it so the
   lock screen shows why the phone is ringing.
2. **Scheduled backstop** (`at > now`): a burst of four time-sensitive local
   notifications (t, +8s, +16s, +24s), each playing `alarm.wav`. This is the
   closest iOS gets to an alarm when the OS has suspended the app before arrival.
   Stable notification ids mean re-scheduling (as GPS refines the ETA) *replaces*
   the previous backstop instead of stacking.

**iOS reality:** unlike Android, a *fully terminated* iOS app cannot run code, so
the notification burst — not live audio — is the backstop there. Keeping the app
in the background (the journey screen open, background location on) is what makes
the reliable live ring possible. This is an OS limitation, not a bug.

## Building it (Codemagic — no Mac needed locally)
The `ios` workflow in `codemagic.yaml` runs on a Mac instance and:
1. builds the web app, `npx cap sync ios`, re-adds `AlarmPlugin` to the native
   `packageClassList` (sync regenerates that list from npm packages only, so the
   app-local plugin must be re-injected), then `pod install`;
2. **with code signing configured** → archives a real, installable `.ipa`;
3. **without signing** → does a `CODE_SIGNING_ALLOWED=NO` compile check that
   proves the native code + plugins build, but produces nothing installable.

## What you MUST do for a device / TestFlight build
Unlike Android (debug-signed APK you can sideload), **iOS requires Apple code
signing to run on any real device.** There is no shortcut.

1. **Apple Developer Program** membership ($99/yr).
2. In Codemagic: add the **App Store Connect** integration (an API key), then
   enable **automatic code signing** for the `com.arriveoclock.app` bundle id.
3. Register the app's bundle id in the Apple Developer portal with these
   capabilities: **Background Modes** (Location updates + Audio), **Push/User
   Notifications** with the **Time Sensitive Notifications** entitlement, and the
   **Associated URL scheme** for OAuth.
4. Add `com.arriveoclock.app://auth-callback` to the Supabase project's allowed
   redirect URLs (same value Android uses — already in `src/auth.js`).
5. First run: grant **Location → Always** and **Notifications** when prompted;
   for the most reliable locked-screen ring, keep the journey screen open.

## Parity checklist with Android
| Capability | Android | iOS |
| --- | --- | --- |
| Motion-based alarm engine (JS) | ✓ shared | ✓ shared |
| Background location tracking | foreground service | `location` background mode |
| Live ring (app alive) | full-screen `AlarmActivity` + insistent notification | `AVAudioPlayer` + time-sensitive notification |
| Backstop when JS suspended | AlarmManager exact alarm | time-sensitive notification burst |
| Ring from *fully killed* app | ✓ (AlarmManager) | notification burst only (OS limit) |
| Google OAuth deep link | intent-filter | `CFBundleURLTypes` scheme |
| Secrets in bundle | none (anon key only) | none (anon key only) |
