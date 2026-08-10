-- =============================================================================
-- ArriveO'Clock — "Gradually increase volume" preference
-- Run in Supabase: SQL Editor → paste → Run  (or `supabase db push`).
--
-- Until this runs, signed-in users can still toggle the setting for the current
-- session, but it won't persist across devices (the update silently no-ops on a
-- missing column). Local/guest mode is unaffected — it uses localStorage.
-- =============================================================================

alter table public.profiles
  add column if not exists volume_fade boolean not null default false;
