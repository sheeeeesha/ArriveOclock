-- =============================================================================
-- Mobile-app waitlist. Anyone (even signed-out) can add their email; nobody can
-- read the list via the anon key (only the Supabase dashboard / service role).
-- Run in Supabase SQL Editor after 0001_init.sql.
-- =============================================================================

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Allow inserts from anon + authenticated; deliberately NO select/update/delete
-- policy, so the list can't be read or scraped with the public anon key.
drop policy if exists "waitlist_insert" on public.waitlist;
create policy "waitlist_insert" on public.waitlist
  for insert to anon, authenticated
  with check (true);
