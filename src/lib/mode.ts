export type AppMode = { kind: 'demo' } | { kind: 'live' } | { kind: 'setup'; detail: string };
export interface PublicEnvironment { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }

/** Explicit demo always wins. An explicit live request never silently becomes a mock run. */
export function resolveMode(env: PublicEnvironment, search: string): AppMode {
  const demo = new URLSearchParams(search).get('demo');
  if (demo === '1') return { kind: 'demo' };
  const url = Boolean(env.VITE_SUPABASE_URL?.trim());
  const key = Boolean(env.VITE_SUPABASE_ANON_KEY?.trim());
  if (url && key) return { kind: 'live' };
  if (!url && !key && demo !== '0') return { kind: 'demo' };
  return { kind: 'setup', detail: 'Live mode needs both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Configure both public values, or open the offline demo.' };
}
