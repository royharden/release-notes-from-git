// Evidence fingerprint and validator-config version, the two values (with the ruling key) a ruling must match to
// replay. Fingerprint = sha256 of canonical JSON of the cited commits' {sha, subject, body, paths}, sorted by sha;
// a cite that does not resolve to an accepted commit contributes {cite, missing: true}, so a ruling on it never
// replays once the commit appears (or vice versa). Config version = sha256 of canonical JSON of
// {thresholds, ignore} (parsed config/thresholds.json and config/ignore.json; key order and whitespace do not count).

import { sha256Canonical } from '../../../supabase/functions/_shared/core/hash.ts';
import { resolveCite } from '../cited/resolve.ts';
import type { ResolveContext } from '../cited/resolve.ts';
import type { IgnoreConfig, Thresholds } from '../config.ts';
import { DEFAULT_IGNORE, DEFAULT_THRESHOLDS } from '../config.ts';

type FingerprintPart = { sha: string; subject: string; body: string; paths: string[] } | { cite: string; missing: true };

export function fingerprintParts(cites: readonly string[], ctx: ResolveContext): FingerprintPart[] {
  const parts = new Map<string, FingerprintPart>();
  for (const cite of cites) {
    const r = resolveCite(cite, { facts: ctx.facts });
    if (r.status === 'resolved') {
      const fact = ctx.facts.commits.get(r.sha);
      if (fact !== undefined) {
        parts.set(`s:${r.sha}`, { sha: r.sha, subject: fact.subject, body: fact.body, paths: [...fact.paths] });
        continue;
      }
    }
    const key = cite.trim().toLowerCase();
    parts.set(`m:${key}`, { cite: key, missing: true });
  }
  return [...parts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, part]) => part);
}

export function evidenceFingerprint(cites: readonly string[], ctx: ResolveContext): Promise<string> {
  return sha256Canonical({ schema: 'fingerprint.v1', commits: fingerprintParts(cites, ctx) });
}

export function configVersion(thresholds: Thresholds = DEFAULT_THRESHOLDS, ignore: IgnoreConfig = DEFAULT_IGNORE): Promise<string> {
  return sha256Canonical({ schema: 'config.v1', thresholds, ignore });
}
