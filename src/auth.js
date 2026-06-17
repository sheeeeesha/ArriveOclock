import { supabase } from './supabaseClient.js';
import { DEMO } from './config.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Authentication. Google OAuth via Supabase in live mode; a fixed local guest
// in demo mode so the prototype is fully usable with no backend.
// ---------------------------------------------------------------------------

function mapUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email || meta.email || '',
    name: meta.full_name || meta.name || (u.email ? u.email.split('@')[0] : 'You'),
    avatar: meta.avatar_url || meta.picture || '',
  };
}

const DEMO_USER = {
  id: 'demo-user',
  email: 'guest@arriveoclock.app',
  name: 'Guest',
  avatar: '',
};
// A local guest (no account). Data stays on this device.
export const GUEST_USER = {
  id: 'guest-local',
  email: '',
  name: 'Guest',
  avatar: '',
};

export async function getCurrentUser() {
  if (DEMO) return DEMO_USER;
  if (state.guest) return GUEST_USER;
  const { data } = await supabase.auth.getUser();
  return mapUser(data?.user);
}

export async function getSession() {
  if (DEMO) return { user: DEMO_USER };
  if (state.guest) return { user: GUEST_USER };
  const { data } = await supabase.auth.getSession();
  return data?.session;
}

export function onAuthChange(cb) {
  if (DEMO) {
    cb(DEMO_USER);
    return () => {};
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(mapUser(session?.user));
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle() {
  if (DEMO) {
    state.user = DEMO_USER;
    return;
  }
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/' },
  });
}

export async function signOut() {
  if (state.guest) {
    state.guest = false;
    try { localStorage.removeItem('aoc_guest'); } catch { /* ignore */ }
    window.location.reload();
    return;
  }
  if (DEMO) return;
  await supabase.auth.signOut();
  window.location.reload();
}

// Continue without an account — local-only mode.
export function continueAsGuest() {
  state.guest = true;
  state.user = GUEST_USER;
  try { localStorage.setItem('aoc_guest', '1'); } catch { /* ignore */ }
}
