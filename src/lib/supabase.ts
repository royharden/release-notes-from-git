import { createClient } from '@supabase/supabase-js';
import type { PublicEnvironment } from './mode.ts';

/** Imported dynamically by Auth in live mode only. Demo never evaluates this module. */
export function createBrowserClient(env: PublicEnvironment) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Live public configuration is incomplete.');
  return createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{ auth: { persistSession: true,autoRefreshToken: true,detectSessionInUrl: true,flowType: 'pkce' } });
}

