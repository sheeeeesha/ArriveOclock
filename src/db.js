import { supabase } from './supabaseClient.js';
import { DEMO } from './config.js';

// "Local" mode = no backend (DEMO) OR the user chose to continue as a guest.
// In both cases data lives in localStorage instead of Supabase.
const local = () => DEMO || state.guest;
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Data access layer. Every function works in both live (Supabase) and demo
// (localStorage) modes and returns the same normalised shapes:
//   place  = { id, name, address, lng, lat, icon, kind }
//   review = { rating, comment }
// ---------------------------------------------------------------------------

const LS = {
  read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* ignore quota */
    }
  },
};

// --- demo seeds ------------------------------------------------------------
const SEED_RECENTS = [
  { id: 'r1', name: 'MIT World Peace University', address: 'Kothrud, Pune', lng: 73.8077, lat: 18.5074 },
  { id: 'r2', name: 'Phoenix Marketcity', address: 'Viman Nagar', lng: 73.917, lat: 18.5621 },
  { id: 'r3', name: 'Aditya Birla Memorial Hospital', address: 'Thergaon, PCMC', lng: 73.7644, lat: 18.6298 },
  { id: 'r4', name: 'Pune Railway Station', address: 'Agarkar Nagar', lng: 73.8744, lat: 18.5286 },
];
const SEED_SAVED = [
  { id: 's1', name: 'Home', address: 'Kothrud, Pune', lng: 73.8077, lat: 18.5074, icon: 'i-home', kind: 'home' },
  { id: 's2', name: 'Work', address: 'Hinjawadi Phase 1', lng: 73.7389, lat: 18.5912, icon: 'i-work', kind: 'work' },
  { id: 's3', name: 'Gym', address: 'Baner Road', lng: 73.7868, lat: 18.559, icon: 'i-bolt', kind: 'other' },
  { id: 's4', name: "Mom's place", address: 'Aundh', lng: 73.8077, lat: 18.559, icon: 'i-pin', kind: 'other' },
];

function uid() {
  return 'x' + Math.random().toString(36).slice(2, 10);
}

// ===========================================================================
// Profile / preferences
// ===========================================================================
export async function loadProfile() {
  if (local()) {
    const p = LS.read('aoc_profile', {
      units: 'km',
      theme: 'light',
      lead_time_min: 5,
      alarm_tone: 'Lo-fi',
      vibrate: true,
      spotify_connected: false,
    });
    state.profile = p;
    return p;
  }
  const { data } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
  state.profile = data || {};
  return state.profile;
}

export async function updateProfile(patch) {
  state.profile = { ...(state.profile || {}), ...patch };
  if (local()) {
    LS.write('aoc_profile', state.profile);
    return;
  }
  await supabase.from('profiles').update(patch).eq('id', state.user.id);
}

// ===========================================================================
// Saved places
// ===========================================================================
export async function getSavedPlaces() {
  if (local()) {
    const list = LS.read('aoc_saved', SEED_SAVED);
    state.saved = list;
    return list;
  }
  const { data } = await supabase
    .from('saved_places')
    .select('*')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: true });
  state.saved = (data || []).map(normPlace);
  return state.saved;
}

export async function addSavedPlace(place) {
  if (local()) {
    const list = LS.read('aoc_saved', SEED_SAVED);
    list.push({ id: uid(), icon: 'i-pin', kind: 'other', ...place });
    LS.write('aoc_saved', list);
    state.saved = list;
    return;
  }
  await supabase.from('saved_places').insert({
    user_id: state.user.id,
    label: place.name,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
    icon: place.icon || 'i-pin',
    kind: place.kind || 'other',
  });
  await getSavedPlaces();
}

export async function updateSavedPlace(id, place) {
  if (local()) {
    const list = LS.read('aoc_saved', SEED_SAVED).map((p) =>
      p.id === id ? { ...p, ...place } : p
    );
    LS.write('aoc_saved', list);
    state.saved = list;
    return;
  }
  await supabase
    .from('saved_places')
    .update({
      label: place.name,
      address: place.address,
      lng: place.lng,
      lat: place.lat,
      icon: place.icon,
      kind: place.kind || 'other',
    })
    .eq('id', id);
  await getSavedPlaces();
}

export async function deleteSavedPlace(id) {
  if (local()) {
    const list = LS.read('aoc_saved', SEED_SAVED).filter((p) => p.id !== id);
    LS.write('aoc_saved', list);
    state.saved = list;
    return;
  }
  await supabase.from('saved_places').delete().eq('id', id);
  await getSavedPlaces();
}

// ===========================================================================
// Recent searches (capped to 20, deduped by name)
// ===========================================================================
export async function getRecents() {
  if (local()) {
    const list = LS.read('aoc_recents', SEED_RECENTS);
    state.recents = list;
    return list;
  }
  const { data } = await supabase
    .from('recent_searches')
    .select('*')
    .eq('user_id', state.user.id)
    .order('searched_at', { ascending: false })
    .limit(20);
  state.recents = (data || []).map(normPlace);
  return state.recents;
}

export async function addRecent(place) {
  if (local()) {
    let list = LS.read('aoc_recents', SEED_RECENTS).filter((r) => r.name !== place.name);
    list.unshift({ id: uid(), ...place });
    list = list.slice(0, 20);
    LS.write('aoc_recents', list);
    state.recents = list;
    return;
  }
  // Remove a prior entry for the same place, then insert fresh.
  await supabase.from('recent_searches').delete().eq('user_id', state.user.id).eq('name', place.name);
  await supabase.from('recent_searches').insert({
    user_id: state.user.id,
    name: place.name,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
  });
  await getRecents();
}

export async function clearRecents() {
  if (local()) {
    LS.write('aoc_recents', []);
    state.recents = [];
    return;
  }
  await supabase.from('recent_searches').delete().eq('user_id', state.user.id);
  state.recents = [];
}

// ===========================================================================
// Journeys
// ===========================================================================
export async function createJourney(j) {
  if (local()) {
    const id = uid();
    LS.write('aoc_active_journey', { id, ...j });
    return id;
  }
  const { data } = await supabase
    .from('journeys')
    .insert({
      user_id: state.user.id,
      origin_label: j.originLabel,
      origin_lng: j.originLng,
      origin_lat: j.originLat,
      dest_label: j.destLabel,
      dest_lng: j.destLng,
      dest_lat: j.destLat,
      mode: j.mode,
      distance_m: j.distanceM,
      duration_s: j.durationS,
      eta: j.eta,
      alarm_lead_min: j.leadMin,
      status: 'active',
    })
    .select('id')
    .single();
  return data?.id;
}

export async function updateJourney(id, patch) {
  if (!id) return;
  if (local()) {
    const aj = LS.read('aoc_active_journey', null);
    if (aj) {
      Object.assign(aj, patch);
      if (patch.status && patch.status !== 'active') {
        localStorage.removeItem('aoc_active_journey');
        const log = LS.read('aoc_journey_log', []);
        log.push({ duration_s: aj.durationS || 0, status: aj.status, alarm_fired: !!aj.alarm_fired });
        LS.write('aoc_journey_log', log);
      } else {
        LS.write('aoc_active_journey', aj);
      }
    }
    return;
  }
  await supabase.from('journeys').update(patch).eq('id', id);
}

// Aggregate trip stats for the profile screen.
export async function getJourneyStats() {
  let list = [];
  if (local()) {
    list = LS.read('aoc_journey_log', []);
  } else if (state.user) {
    const { data } = await supabase
      .from('journeys')
      .select('duration_s,status,alarm_fired')
      .eq('user_id', state.user.id);
    list = data || [];
  }
  const trips = list.length;
  const missed = list.filter((j) => j.status === 'completed' && !j.alarm_fired).length;
  const hours = list.reduce((s, j) => s + (j.duration_s || 0), 0) / 3600;
  return { trips, missed, hours: Math.round(hours * 10) / 10 };
}

export async function getActiveJourney() {
  if (local()) return LS.read('aoc_active_journey', null);
  const { data } = await supabase
    .from('journeys')
    .select('*')
    .eq('user_id', state.user.id)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ===========================================================================
// Waitlist (mobile-app early access) — anonymous insert, no auth needed
// ===========================================================================
export async function joinWaitlist(email) {
  if (DEMO) {
    LS.write('aoc_waitlist_email', email);
    return { ok: true };
  }
  const { error } = await supabase.from('waitlist').insert({ email });
  return { ok: !error, error };
}

// ===========================================================================
// Reviews
// ===========================================================================
export async function submitReview(review) {
  if (local()) {
    const list = LS.read('aoc_reviews', []);
    list.push({ id: uid(), ...review, created_at: new Date().toISOString() });
    LS.write('aoc_reviews', list);
    return;
  }
  await supabase.from('reviews').insert({
    user_id: state.user.id,
    rating: review.rating,
    comment: review.comment,
  });
}

// --- helpers ---------------------------------------------------------------
function normPlace(row) {
  return {
    id: row.id,
    name: row.name || row.label,
    address: row.address || '',
    lng: row.lng,
    lat: row.lat,
    icon: row.icon || 'i-clock',
    kind: row.kind || 'other',
  };
}
