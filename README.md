# ArriveO'Clock

A travel-companion web app that wakes you up **right before your stop** — the
alarm is timed off your **live movement**, not a fixed countdown. Pick a
destination and a transport mode, start the journey, and ArriveO'Clock rings a
few minutes before you actually arrive.

Works **anywhere in the world, for free, with no API keys and no sign-up.**
Premium, strictly monochrome (black / white / grayscale) UI with a custom
MapLibre map style and light + dark themes.

---

## Why it's free + global

Every core capability runs on free, keyless, open services:

| Concern        | Service (default)                          | Key? |
|----------------|--------------------------------------------|------|
| Map tiles      | **OpenFreeMap** (OpenStreetMap vector)     | none |
| Map rendering  | **MapLibre GL** + custom monochrome style  | none |
| Place search   | **Photon** (Komoot, OSM)                   | none |
| Driving route  | **OSRM** public router                     | none |
| Transit ETA    | **Transitous / MOTIS** (where feeds exist) | none |
| The alarm      | **device GPS + Web Audio tones**           | none |
| Login / sync   | **Supabase** *(optional)*                  | anon |

With an **empty `.env`** the app is fully functional; it just keeps data
per-device (localStorage) instead of syncing. Add Supabase only if you want
Google login + cross-device sync.

---

## The motion-based alarm (the core idea)

The alarm does **not** depend on a routing API. Once moving, it computes the
**remaining distance along your route ÷ your rolling GPS speed** to get a live
ETA, and rings when `ETA ≤ lead time` (default 5 min, editable). Because it
measures *your actual movement*, it's:

- **free + global + offline** — no network needed during the trip,
- **mode-agnostic** — a 60 km/h train and an 18 km/h bus are handled identically,
- **self-correcting** — traffic or delays just push the alarm later.

Routing APIs are used only on the *planning* screen (the "~28 min" estimate and
the drawn line).

### Public transit

There is no free, global, turnkey transit-routing API (transit needs per-city
GTFS feeds). So transit is handled two ways:

1. **Live alarm** — motion-based, so it's accurate on any bus/metro/train,
   anywhere, with zero transit data.
2. **Planning ETA** — `api/route.js` queries **Transitous/MOTIS** (free, keyless)
   for real transit times where open feeds exist; elsewhere it shows a clearly
   labelled distance estimate (typical per-mode speed + dwell factor).

---

## Battery strategy

A continuous high-accuracy `watchPosition()` stream is the biggest drain, so we
don't use one. The alarm engine (`src/alarm.js`) instead samples **adaptively**:

- **One-shot GPS fixes with sleeps between them** (GPS is idle in between); a
  cheap 1 s ticker animates the countdown.
- **Distance-aware cadence** — far away → check every few minutes; ~3 km out →
  every ~15–20 s; within the final stretch → ~8–12 s. The next wake time is
  derived from time-to-alarm, so we never poll more than necessary.
- **Accuracy tiering** — low-power (network) location when far; high-accuracy
  GPS only switches on near the destination.

The live screen shows the current cadence (e.g. "Live GPS · next check in 30s ·
low-power") so the behaviour is transparent.

> **Background limit (honest):** browsers throttle/suspend background tabs, so a
> guaranteed alarm while the screen is off needs the app installed as a PWA with
> notifications, and for true OS-level geofencing a thin native shell
> (Capacitor) — a documented next step. The adaptive foreground engine ships now.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321 — works immediately, no .env needed
```

`npm run build` → `dist/`. `npm run preview` serves the build.

> Geolocation needs HTTPS (or `localhost`). On a deployed site it works; on
> plain HTTP it falls back to a default centre and the journey is simulated.

---

## Optional: enable login/sync + deploy

### Supabase (cross-device login + sync)
1. Create a project at <https://supabase.com>.
2. **SQL Editor** → run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   (tables, Row-Level Security, auto-profile trigger).
3. **Authentication → Providers → Google**: enable it (create an OAuth client in
   Google Cloud; redirect URI `https://<ref>.supabase.co/auth/v1/callback`), and
   add your app origins under **URL Configuration**.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.

### Deploy to Vercel
```bash
vercel
```
Add any `.env` values in **Vercel → Settings → Environment Variables**.
`vercel.json` wires the SPA rewrites and the `api/` serverless functions
(`api/route.js` = the transit proxy). No keys are required for a free deploy.

---

## Project structure

```
index.html               UI markup + the full monochrome design system (CSS)
api/route.js             Vercel serverless: free transit-ETA proxy (Transitous/MOTIS)
supabase/migrations/     SQL schema + RLS + new-user trigger (only if using Supabase)
src/
  config.js              env + free service endpoints
  state.js               app state, alarm tones, transport modes
  supabaseClient.js      Supabase client (null when unconfigured → local mode)
  auth.js                Google OAuth / session (local guest when unconfigured)
  db.js                  profiles, saved places, recents, journeys, reviews
  geocode.js             Photon search + reverse geocode
  directions.js          OSRM driving + transit ETA + estimate fallback
  map.js                 MapLibre monochrome style, route, markers (+ offline SVG)
  geolocation.js         one-shot GPS fixes (battery-friendly)
  alarm.js               the motion-based, adaptive-cadence alarm engine
  sound.js               Web Audio alarm tones (10 built-in, no files)
  main.js                router, rendering, init — wires everything together
```

---

## Security & privacy

- No private keys reach the browser. The only optional key (Supabase anon) is
  public and constrained by Row-Level Security to the signed-in user's own rows.
- Location is used only to compute live ETA on-device; fixes are not sent to any
  third party during a journey (routing happens only on the planning screen).
