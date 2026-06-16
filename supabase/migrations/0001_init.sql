-- =============================================================================
-- ArriveO'Clock — initial schema
-- Run in Supabase: SQL Editor → paste → Run  (or `supabase db push`).
-- Every table is protected by Row-Level Security so a signed-in user can only
-- ever read/write their own rows using the public anon key.
-- =============================================================================

-- ---------- profiles ---------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  full_name         text,
  avatar_url        text,
  units             text not null default 'km',
  theme             text not null default 'light',
  lead_time_min     int  not null default 5,
  alarm_tone        text not null default 'Lo-fi',
  vibrate           boolean not null default true,
  spotify_connected boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------- saved_places -----------------------------------------------------
create table if not exists public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null,
  address    text,
  lng        double precision,
  lat        double precision,
  icon       text default 'i-pin',
  kind       text default 'other',
  created_at timestamptz not null default now()
);
create index if not exists saved_places_user_idx on public.saved_places (user_id);

-- ---------- recent_searches --------------------------------------------------
create table if not exists public.recent_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  address     text,
  lng         double precision,
  lat         double precision,
  searched_at timestamptz not null default now()
);
create index if not exists recent_searches_user_idx on public.recent_searches (user_id, searched_at desc);

-- ---------- journeys ---------------------------------------------------------
create table if not exists public.journeys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  origin_label   text,
  origin_lng     double precision,
  origin_lat     double precision,
  dest_label     text,
  dest_lng       double precision,
  dest_lat       double precision,
  mode           text,
  distance_m     int,
  duration_s     int,
  eta            timestamptz,
  alarm_lead_min int default 5,
  alarm_fired    boolean default false,
  status         text not null default 'active',  -- active | completed | cancelled
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);
create index if not exists journeys_user_idx on public.journeys (user_id, started_at desc);

-- ---------- reviews ----------------------------------------------------------
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  rating     int not null check (rating between 1 and 5),
  comment    text,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.saved_places    enable row level security;
alter table public.recent_searches enable row level security;
alter table public.journeys        enable row level security;
alter table public.reviews         enable row level security;

-- profiles: a user sees/edits only their own profile row
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- owner-only policy applied to the user_id tables
do $$
declare t text;
begin
  foreach t in array array['saved_places','recent_searches','journeys','reviews'] loop
    execute format('drop policy if exists "%1$s_owner" on public.%1$s;', t);
    execute format(
      'create policy "%1$s_owner" on public.%1$s for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
  end loop;
end $$;

-- =============================================================================
-- Auto-create a profile row when a new auth user signs up
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
