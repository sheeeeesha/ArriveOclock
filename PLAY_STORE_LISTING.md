# Play Store listing — ArriveO'Clock

Copy/paste into the Play Console. Replace the contact email and host the
privacy policy (deployed at `https://arriveoclock.vercel.app/privacy.html`).

---

## App details
- **App name:** ArriveO'Clock
- **Default language:** English (United States)
- **App or game:** App
- **Category:** Maps & Navigation  (alt: Travel & Local)
- **Tags:** alarm, commute, transit, navigation
- **Contact email:** support@arriveoclock.app  ← replace with yours
- **Website:** https://arriveoclock.vercel.app
- **Privacy policy:** https://arriveoclock.vercel.app/privacy.html

## Short description (≤ 80 chars)
> Sleep on the metro — a live-ETA alarm that wakes you right before your stop.

## Full description
> Never miss your stop again.
>
> ArriveO'Clock is a travel companion that wakes you up just before you arrive — not on a fixed timer, but from your real movement. It tracks your live location, estimates your arrival continuously, and rings a few minutes before your stop so you can rest, read or work without watching the map.
>
> • Live-ETA alarm — the alarm shifts with traffic, slow trains and long stops, and fires just before you actually arrive.
> • Works anywhere, free — any city, any bus, metro or train. No subscription, no API keys.
> • Rings even when locked — a full-screen alarm wakes you over the lock screen, so you can pocket your phone.
> • Set it in seconds — search a stop, drop a pin, pick how many minutes of warning you want, and relax.
> • Private by design — use it as a guest with everything on-device, or sign in to sync your saved places across devices. We never sell your data.
>
> Set your stop. Doze off. Arrive on time.

## Graphics needed (you create)
- App icon: 512×512 PNG (the monochrome pin+clock — export from the brand mark).
- Feature graphic: 1024×500 PNG.
- Phone screenshots: 2–8, 16:9 or 9:16 (e.g. home/map, set-alarm, live journey, alarm ringing, settings).

---

## Background-location declaration (Play asks for this — be specific)
> ArriveO'Clock's core feature is a location-based arrival alarm. While a trip is active, the app needs background location ("Allow all the time") to keep estimating the user's live ETA and ring the alarm at the right moment when the screen is off or the app is backgrounded — the situations users rely on (sleeping/reading on a commute). Location is used only to compute ETA and trigger the alarm during an active trip; it is not used for ads or shared with third parties for their own use. Foreground location alone cannot deliver the alarm reliably because mobile OSes suspend background web/JS execution.

Record a ~30s screen capture showing: starting a trip → locking the phone → the alarm ringing → the in-app disclosure that explains background use. Upload it when prompted.

## Foreground service declaration
- Type: **Location**. Used to keep the arrival-alarm tracking alive while the trip is in progress and the screen is off.

## Exact alarm / full-screen intent
- `USE_EXACT_ALARM` + `USE_FULL_SCREEN_INTENT`: the app's core function is an alarm; the full-screen alarm must fire at a precise time over the lock screen. Confirm "alarm/clock" use in the policy declarations if asked.

## Data safety form answers
- **Collected:** Location (precise) — App functionality; Personal info (name, email — only if user signs in with Google) — Account management.
- **Background location:** Yes (active trips only).
- **Shared with third parties:** No (location is sent to map/routing/geocoding providers to perform the user's request, not shared for their independent use).
- **Sold:** No.
- **Encrypted in transit:** Yes.
- **User can request deletion:** Yes (via the contact email).

## Content rating
- Complete the questionnaire as a utility/navigation app → expected **Everyone**. No user-generated public content, no ads.

## Target audience
- 18+ / general audience (not designed for children).
