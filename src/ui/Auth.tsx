import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '../lib/supabase.ts';

export default function Auth({ onSession,onRestore }: { onSession: (client: SupabaseClient | null,owner: string | null) => void; onRestore: (id: string) => void }) {
  const [client] = useState(() => createBrowserClient(import.meta.env));
  const [owner,setOwner] = useState<string | null>(null);
  const [identity,setIdentity] = useState(''); const [password,setPassword] = useState('');
  const [recovery,setRecovery] = useState(false); const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [runs,setRuns] = useState<{ id: string; repo_label: string; created_at: string }[]>([]);
  useEffect(() => {
    let active = true;
    const apply = (id: string | null) => { if (active) { setOwner(id); onSession(id ? client : null,id); } };
    void client.auth.getSession().then(({ data,error }) => { if (active && error) setMessage(error.message); apply(data.session?.user.id ?? null); });
    const { data } = client.auth.onAuthStateChange((event,session) => { if (event === 'PASSWORD_RECOVERY' && active) setRecovery(true); apply(session?.user.id ?? null); });
    return () => { active = false; data.subscription.unsubscribe(); };
  },[client,onSession]);
  useEffect(() => {
    let active = true; setRuns([]);
    if (owner) void client.from('runs').select('id,repo_label,created_at').eq('owner',owner).order('created_at',{ ascending: false }).limit(20).then(({ data,error }) => { if (active) { if (error) setMessage(error.message); else setRuns(data ?? []); } });
    return () => { active = false; };
  },[client,owner,refresh]);
  async function act(action: 'signin'|'signup'|'recover'|'update'|'signout') {
    setBusy(true); setMessage('');
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?demo=0`;
      const result = action === 'signin' ? await client.auth.signInWithPassword({ email: identity,password })
        : action === 'signup' ? await client.auth.signUp({ email: identity,password,options: { emailRedirectTo: redirectTo } })
        : action === 'recover' ? await client.auth.resetPasswordForEmail(identity,{ redirectTo })
        : action === 'update' ? await client.auth.updateUser({ password }) : await client.auth.signOut();
      if (result.error) throw result.error;
      setPassword('');
      if (action === 'recover' || action === 'signup') setMessage('Check your inbox for the account link.');
      if (action === 'update') { setRecovery(false); setMessage('Password updated.'); }
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Account" className="panel"><h2>{recovery ? 'Choose a new password' : owner ? 'Your live account' : 'Sign in for live generation'}</h2>
    {!owner && <label>Account email<input type="email" autoComplete="email" value={identity} onChange={(e) => setIdentity(e.target.value)} /></label>}
    {(!owner || recovery) && <label>Password<input type="password" autoComplete={recovery ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
    <div>{recovery ? <button disabled={busy || password.length < 8} onClick={() => void act('update')}>Save new password</button> : owner ? <button disabled={busy} onClick={() => void act('signout')}>Sign out</button> : <><button disabled={busy || !identity || !password} onClick={() => void act('signin')}>Sign in</button><button disabled={busy || !identity || password.length < 8} onClick={() => void act('signup')}>Create account</button><button disabled={busy || !identity} onClick={() => void act('recover')}>Recover password</button></>}</div>
    {message && <p role="status">{message}</p>}
    {owner && <><button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh saved runs</button><label>Restore an owned run<select defaultValue="" onChange={(event) => { if (event.target.value) onRestore(event.target.value); }}><option value="">Select a recent run</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.repo_label} · {run.created_at}</option>)}</select></label><p>After selecting a run, upload the original file to restore commit evidence. Matching sanitized input and validation configuration are required before review or export.</p></>}
  </section>;
}
