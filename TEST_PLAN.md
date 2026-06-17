# ArriveO'Clock — Test Plan: Location Setting & Timer

A checklist for manually verifying the two highest-risk subsystems: **location
setting** (geolocation, origin/destination, saved places, search) and the
**timer** (route ETA + the motion-based alarm engine). Tick each box once
verified. "Expected" describes the correct behaviour.

Key constants to keep in mind while testing:
- Default lead time = **5 min** (alarm fires when remaining ETA ≤ lead).
- Geolocation one-shot timeout = **9 s**, then falls back to a default centre.
- Search debounce = **~280 ms**; min query length = **2 chars**.
- Adaptive GPS cadence: far ≈ up to 5 min between fixes, &lt;3 km ≈ 12–20 s,
  alarm imminent ≈ 8 s; high-accuracy GPS only switches on within ~4 km.
- Sim mode (no GPS / denied / fallback) runs the countdown accelerated
  (~1 travel-minute per real second) so the flow is demonstrable.
- "Local mode" = guest **or** no Supabase → data in `localStorage`.

> Tip: test on a real phone (GPS) for the live engine, and on desktop
> (Wi-Fi/IP location) to exercise the low-accuracy + sim fallbacks. Use Chrome
> DevTools → Sensors to mock/override geolocation and simulate movement.

---

## A. Location permission & detection

- [ ] **Permission granted (mobile/GPS):** marker appears at your real position; home map recenters; "From" shows a nearby place name.
- [ ] **Permission granted (desktop/Wi-Fi):** location resolves approximately; no crash; user can correct via the "From" row.
- [ ] **Permission denied:** toast "Enable location…"; map stays at default centre; origin marked as a fallback (no marker dropped).
- [ ] **Prompt dismissed / no response:** after ~9 s, falls back to default centre without hanging the UI.
- [ ] **Deny, then grant later:** re-opening a route (or "locate me") re-fetches — a fallback origin is **never** cached, so ETAs become correct once granted. *(Regression guard.)*
- [ ] **Insecure origin (plain HTTP, not localhost):** geolocation unavailable → graceful fallback, no console error thrown to the user.
- [ ] **Geolocation API absent (old browser):** falls back, app still usable.
- [ ] **"Locate me" FAB:** recenters and (re)drops the marker; tapping repeatedly doesn't spawn duplicate markers.
- [ ] **Reverse-geocode failure (Photon down):** "From" label degrades to coordinates/"Current position"; no crash.
- [ ] **Move physically then re-locate:** marker updates to the new position.

## B. Setting the destination

- [ ] **Search type-ahead:** typing ≥2 chars returns results; <2 chars shows nothing.
- [ ] **Debounce:** typing fast then stopping issues only the final query (no flicker of stale results).
- [ ] **Pick a result:** navigates to the route screen with that destination; it's added to Recents.
- [ ] **No results:** empty/uncommon query shows no rows and doesn't error.
- [ ] **Search network failure (offline):** falls back to the built-in list; no crash.
- [ ] **Unicode / RTL / very long place names:** render correctly and are **HTML-escaped** (e.g. a name containing `<img onerror>` shows as text, never executes). *(Security.)*
- [ ] **Recents dedupe:** picking the same place twice doesn't create duplicate recent rows; newest is on top.
- [ ] **Recents cap:** after 20+ distinct searches, the list caps at 20.
- [ ] **Clear history:** trash icon empties Recents (and persists empty).
- [ ] **Home / Work chips:** jump straight to a route for the saved Home/Work; if none saved, opens Saved places instead.
- [ ] **Tap a Recent / Saved row:** populates the route screen correctly.

## C. Setting the start point (origin) & swap

- [ ] **Tap "From" row:** opens the picker titled "Set start point".
- [ ] **Choose a new start:** origin updates and the route + all mode ETAs **recompute** from it.
- [ ] **Cancel the From picker (back):** returns to the route screen; origin unchanged; picker state reset.
- [ ] **Tap "To" row → choose:** destination updates; route recomputes; origin unchanged.
- [ ] **Swap (⇅):** origin and destination switch; route recomputes; swap with no destination set is a safe no-op.
- [ ] **Origin == destination (same place):** distance ≈ 0, duration ≈ 0; no NaN/Infinity; Start Journey behaves sanely.
- [ ] **Cross-continent / unroutable pair:** OSRM returns no route → falls back to an estimate line; ETA large but finite; no crash.

## D. Saved places (CRUD + location picker)

- [ ] **Add place:** "Add a place" → empty editor titled "Add place" (no Delete button).
- [ ] **Set location via picker:** "Tap to set location" → search → choose → returns to editor with name/coords filled.
- [ ] **Save with label + location:** appears in Saved list with the chosen icon; persists across reload.
- [ ] **Save without a label:** blocked with toast "Give this place a name".
- [ ] **Save without a location:** blocked with toast "Set a location first".
- [ ] **Edit existing place:** pencil opens editor pre-filled (with Delete button); rename / change icon / change location all persist.
- [ ] **Delete place:** removed from list and storage; returns to Saved.
- [ ] **Icon picker:** selected icon is clearly visible (dark on the white selected tile) and persists.
- [ ] **Cancel mid-edit (back):** no changes saved.
- [ ] **Duplicate labels / emoji / HTML in label:** allowed, rendered escaped, no breakage.
- [ ] **Tap a saved row body:** uses it as destination; tapping the pencil edits — the two don't conflict.

## E. Route & ETA computation

- [ ] **Car ETA (OSRM):** realistic duration + distance for a known city trip.
- [ ] **Arrival clock:** equals now + duration; updates when you switch modes.
- [ ] **Mode switch:** car/bus/metro/train each show distinct, plausible ETAs (transit = estimate with access/wait overhead); the **active mode icon is visible** (dark on white). *(Color regression guard.)*
- [ ] **Transit estimate sanity:** for a short trip, transit isn't absurdly fast (overhead applied); for a long trip, scales reasonably.
- [ ] **Loading state:** while routing, stats show "—"/"…", never a stale mock value like "02:10". *(Regression guard.)*
- [ ] **Routing service down (OSRM/Photon offline):** falls back to a straight-ish estimate; screen still usable.
- [ ] **Transit backend (deployed):** `/api/route` returns a real transit time where a feed exists; estimate elsewhere; GET to `/api/route` returns 405.

## F. Timer / live tracking (motion-based alarm)

- [ ] **Start Journey:** transitions to the active screen; banner + countdown + "Live GPS · battery-saver" status appear; a journey record is created.
- [ ] **Moving steadily:** countdown ticks down smoothly; "min left" / "km left" / "km/h" update on each fix.
- [ ] **Vehicle stops:** speed → ~0; **countdown holds** (doesn't tick to 0); does **not** fire the alarm while stopped.
- [ ] **Resume after a stop:** ETA recomputes from live speed and resumes counting down.
- [ ] **Speeds up / slows down:** ETA adjusts at the next fix (faster → sooner, slower → later).
- [ ] **Off-route / backtracking:** remaining distance recomputes from the nearest route point; ETA may rise; no premature alarm.
- [ ] **Adaptive cadence:** when far, GPS checks are infrequent (status shows a longer "next check"); approaching the stop, checks get frequent and switch to "precise".
- [ ] **GPS lost mid-journey:** status shows "GPS unavailable · estimating" and the countdown continues (sim) so the alarm still fires.
- [ ] **No GPS at all (desktop/denied):** runs in simulated mode (accelerated) and still reaches the alarm.
- [ ] **Battery:** GPS is not a continuous stream — confirm fixes are spaced (not constant), especially when far from the destination.

## G. Alarm trigger & dismissal

- [ ] **Normal fire:** alarm triggers when remaining ETA ≤ lead time (~5 min out), showing "Almost there" + the destination name.
- [ ] **Trip shorter than lead time** (e.g. 3-min trip, 5-min lead): fires (almost) immediately on Start — expected, not a bug.
- [ ] **Tone plays on fire:** the selected built-in tone sounds (audio was unlocked by the Start tap).
- [ ] **Vibration:** device vibrates if supported and enabled; desktop = silent, no error.
- [ ] **System notification:** if notifications were granted, one appears (test with tab backgrounded); if denied, the in-app overlay + tone still fire.
- [ ] **Dismiss alarm:** tone stops; journey marked completed; returns home; "Ongoing" badge cleared.
- [ ] **Tone selection:** changing the tone in Settings previews it; the chosen tone is what fires; the live card pill shows it.
- [ ] **Progress ring / bar:** fill reflects progress and never overflows or shows negative.

## H. Lifecycle & persistence

- [ ] **End journey (cancel) before arrival:** all timers cleared; alarm does not fire; status = cancelled; back home.
- [ ] **Start → cancel → start again:** no leftover timers from the previous run (countdown isn't doubled/fast).
- [ ] **"Ongoing" tile:** while a journey is active, resumes the active screen; with none active, toasts "No journey in progress".
- [ ] **Reload mid-journey:** ⚠️ document actual behaviour — in-memory journey state is lost on reload, so the live screen does **not** auto-resume (the DB row persists). *(Known gap — flag if resume-on-reload is desired.)*
- [ ] **Journey stats (Profile):** completing a trip increments **Trips** and **Hours**; **Missed** only increments if you arrived without the alarm firing; a brand-new account shows 0/0/0h.
- [ ] **Guest vs signed-in:** recents/saved/journeys persist to `localStorage` as a guest and to Supabase when signed in; they don't bleed across.
- [ ] **Sign out:** clears the session (and guest flag) and returns to login.

## I. Cross-cutting edge cases

- [ ] **Theme toggle mid-journey:** light↔dark re-skins the map and route without losing the countdown.
- [ ] **Arrival clock crossing midnight:** e.g. 23:50 + 0:30 → shows `00:20`, not `24:20`.
- [ ] **Rapid screen switching during routing:** navigating away while a route computes doesn't apply stale results to the wrong screen.
- [ ] **Very long trip (hours):** countdown, cadence, and ring behave; no overflow.
- [ ] **Permissions changed at OS level mid-session:** revoking location mid-journey degrades gracefully to estimating.
- [ ] **Offline cold start (PWA):** with the service worker installed, the app **launches** offline; an already-started journey's alarm still fires; new search/tiles/routing are unavailable until back online.
- [ ] **Two tabs open:** starting a journey in one doesn't corrupt the other (each tab has its own in-memory timer).
- [ ] **Small screen (360 px) & large/desktop:** location rows, picker, and the active card stay usable and don't overflow.

---

### Suggested smoke test (2 minutes)
1. Open app → allow location → marker shows.
2. Search a nearby place → route screen shows car ETA → switch modes (icons visible).
3. Tap "From" → set a different start → ETA recomputes.
4. Start Journey → countdown runs → (mock movement / sim) → alarm fires "Almost there" → Dismiss → back home.
5. Profile → Trips incremented. Save a place, edit it, delete it.
