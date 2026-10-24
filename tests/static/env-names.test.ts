import { describe, expect, it } from 'vitest';
import { readText } from '../helpers/fixtures.ts';

describe('public and deployed environment-name contract', () => {
  it('publishes exactly two public configuration placeholders', () => {
    const names = readText('.env.example').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => line.split('=')[0]).sort();
    expect(names).toEqual(['VITE_SUPABASE_ANON_KEY','VITE_SUPABASE_URL']);
  });
  // BOLT-HANDOFF.md is written in M6. This assertion is deliberately deferred until then.
  it('every server env read is inventoried in the M6 handoff and has no VITE_ prefix', () => {
    const source = readText('supabase/functions/generate-notes/index.ts');
    const names = [...source.matchAll(/Deno\.env\.get\('([^']+)'\)/g)].map((match) => match[1]!);
    const handoff = readText('BOLT-HANDOFF.md');
    for (const env of names) { expect(env.startsWith('VITE_')).toBe(false); expect(handoff).toContain(env); }
    expect(names).toContain('MODEL_PRICES_JSON');
  });
  it('the browser has no service credential and demo evaluates no Supabase import', () => {
    for (const path of ['src/ui/App.tsx','src/services/generation.ts','src/data/memory-repo.ts','src/data/supabase-repo.ts','src/lib/supabase.ts']) {
      expect(readText(path)).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
    const app = readText('src/ui/App.tsx');
    expect(app).toContain("lazy(() => import('./Auth.tsx'))");
    expect(app).toContain("mode.kind === 'live' && <Suspense");
    expect(readText('src/data/memory-repo.ts')).not.toMatch(/from ['"]@supabase/);
    expect(readText('src/services/generation.ts')).not.toMatch(/import (?!type)[^\n]+from ['"]@supabase/);
  });
});
