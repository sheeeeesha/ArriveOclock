import { supabase } from './supabaseClient.js';
import { DEMO } from './config.js';
import { state } from './state.js';
import { isNative } from './native.js';

// Deep link the native app handles after Google OAuth (registered as an
// intent-filter in AndroidManifest + allow-listed in Supabase redirect URLs).
const NATIVE_REDIRECT = 'com.arriveoclock.app://auth-callback';

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
  if (isNative) return nativeGoogleSignIn();
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/' },
  });
}

// Native: Google blocks OAuth inside a WebView, so we open the system browser
// (Custom Tabs) and return via a deep link.
async function nativeGoogleSignIn() {
  const { Browser } = await import('@capacitor/browser');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return;
  await Browser.open({ url: data.url });
}

// Register the deep-link handler that completes the session after OAuth.
// Call once at startup on native.
export async function initNativeAuth() {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  const { Browser } = await import('@capacitor/browser');
  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith('com.arriveoclock.app://')) return;
    try {
      const u = new URL(url);
      const code = u.searchParams.get('code');
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      } else if (u.hash) {
        const hp = new URLSearchParams(u.hash.replace(/^#/, ''));
        const at = hp.get('access_token');
        const rt = hp.get('refresh_token');
        if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt });
      }
    } catch { /* ignore malformed callback */ }
    try { await Browser.close(); } catch { /* already closed */ }
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
