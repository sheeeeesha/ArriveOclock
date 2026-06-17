# ArriveO'Clock Android — security posture

What's hardened, what's inherent, and what you must do for a **production**
(Play Store) release vs the debug APK you sideload for testing.

> Reality check: no app is "perfectly secure." The goal here is a sound posture
> with no obvious holes. The biggest single item is **building a signed RELEASE
> APK** for distribution (the Codemagic debug APK is for testing only).

## Already hardened (in the repo)
- **No secrets in the APK.** The bundle contains only the Supabase **URL + anon
  key**, which are *public by design* and constrained by **Row-Level Security**
  (a user can only ever read/write their own rows). No service-role key, no
  Google/transit server keys (those live on Vercel; the app never sees them).
- **OAuth uses PKCE** (`flowType: 'pkce'`). The native sign-in returns via a
  custom-scheme deep link; PKCE means an intercepted authorization code is
  **useless without the verifier** held only by this app — closes the main
  custom-scheme risk.
- **HTTPS-only WebView.** `androidScheme: https` serves the app from
  `https://localhost`, and `usesCleartextTraffic="false"` + `allowMixedContent:
  false` block any plaintext/MITM. All external calls (Supabase, OpenFreeMap,
  Photon, OSRM) are HTTPS.
- **No backup extraction.** `allowBackup="false"` stops `adb backup` from pulling
  the app's local data / session tokens off the device.
- **Minimal permissions.** Only location (incl. background, for the alarm),
  notifications, foreground-service, wake-lock, internet. No camera, mic,
  contacts, storage, SMS, etc.
- **XSS-safe rendering** (shared with web): all third-party/user text is
  HTML-escaped before DOM insertion.

## You MUST do this for a public release
The Codemagic **debug** APK is `debuggable=true` and debug-signed — fine for
your own phone, **not** for distribution. For a real release:

1. **Create a release keystore** (once), keep it private (never commit it):
   ```
   keytool -genkey -v -keystore arriveoclock.keystore -alias arriveoclock \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **Add it to Codemagic** → Code signing identities → upload the keystore +
   passwords (stored encrypted by Codemagic, not in git).
3. **Build a signed release** (`assembleRelease`/`bundleRelease`) — this is
   `debuggable=false` and lets R8 shrink/obfuscate. Add a release workflow to
   `codemagic.yaml` referencing the signing reference, e.g.:
   ```yaml
     android-release:
       environment:
         android_signing: [arriveoclock_keystore]
         groups: [supabase]
       scripts:
         - npm ci
         - npm run build
         - npx cap sync android
         - cd android && ./gradlew bundleRelease   # AAB for Play
   ```
4. In `android/app/build.gradle`, enable for the release type:
   `minifyEnabled true` + `shrinkResources true` (R8 obfuscation/shrinking).
5. Play Store: complete the **background-location policy declaration** +
   prominent disclosure + privacy policy (Google requires it for
   `ACCESS_BACKGROUND_LOCATION`).

## Worth doing later (optional hardening)
- **Android App Links** (verified `https://arriveoclock.vercel.app/...` deep
  link) instead of the custom scheme, so no other app can register it. PKCE
  already mitigates the token risk, so this is defense-in-depth.
- **In-app CSP meta tag.** The Vercel CSP header doesn't apply to the local
  WebView. A `<meta http-equiv="Content-Security-Policy">` in index.html would
  lock down `connect-src` in the app too. *Test it on-device first* — too-strict
  a policy can break the Capacitor bridge (blank screen).
- **Certificate pinning** for Supabase if you want to resist MITM on rooted
  devices (heavier; usually overkill for this app).

## Not a concern
- The committed `android/` project contains **no keystore or secret** (debug
  builds use the auto-generated debug key). Keep any release keystore out of git.
