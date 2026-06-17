import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabase } from './config.js';

// Null in demo mode — every caller must tolerate a null client.
export const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // PKCE: an intercepted OAuth code is useless without the verifier held
        // only by this client — important for the native custom-scheme deep link.
        flowType: 'pkce',
      },
    })
  : null;
