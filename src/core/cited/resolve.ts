// Commit-cite resolver. Known shas = accepted commits, rejected records that kept a sha, declared outside shas and
// boundary parents; a prefix is checked for collisions against all of them.
//   exact or unique-prefix accepted commit         -> resolved (active unless cancelled by an in-range revert)
//   rejected record                                -> not_found, with the reject code ("commit rejected at parse")
//   outside_shas                                   -> out_of_range (basis outside_shas)
//   parent of an accepted commit, not supplied     -> out_of_range (basis boundary_parent)
//   accepted, but not in the request's input       -> out_of_range (basis not_in_request), when a request set is given
//   prefix matching two or more known shas         -> ambiguous
//   anything else (malformed, too short, unknown)  -> not_found
// Declared membership only: this does not verify ancestry or the range itself.

import type { CiteResolution } from '../validate/reasons.ts';
import type { FactIndex } from '../gitfacts/facts.ts';
import { parsePointer } from './pointer.ts';

export interface ResolveContext {
  facts: Pick<FactIndex, 'commits' | 'rejected' | 'outside' | 'boundaryParents'>;
  /** Full shas a model request was allowed to cite; omitted when validating against the whole run. */
  requestShas?: ReadonlySet<string>;
}

export function resolveCite(cite: string, ctx: ResolveContext): CiteResolution {
  const pointer = parsePointer(cite);
  if (pointer === null) return { cite, status: 'not_found', rejectedCode: null };
  const ref = pointer.ref;
  const known = knownShas(ctx);
  // A 40-character cite can be an exact SHA-1 or a SHA-256 prefix. Prefer a known exact sha, then
  // check prefixes at every accepted length so collisions and outside/rejected provenance survive.
  if (known.includes(ref)) return classify(cite, ref, ctx);
  const candidates = known.filter((sha) => sha.startsWith(ref));
  if (candidates.length === 0) return { cite, status: 'not_found', rejectedCode: null };
  if (candidates.length > 1) return { cite, status: 'ambiguous', candidates: candidates.sort() };
  return classify(cite, candidates[0] as string, ctx);
}

export function resolveCites(cites: readonly string[], ctx: ResolveContext): CiteResolution[] {
  return cites.map((cite) => resolveCite(cite, ctx));
}

function classify(cite: string, sha: string, ctx: ResolveContext): CiteResolution {
  const { facts } = ctx;
  const fact = facts.commits.get(sha);
  if (fact !== undefined) {
    if (ctx.requestShas !== undefined && !ctx.requestShas.has(sha)) return { cite, status: 'out_of_range', basis: 'not_in_request' };
    return { cite, status: 'resolved', sha, active: fact.active };
  }
  const rejectedCode = facts.rejected.get(sha);
  if (rejectedCode !== undefined) return { cite, status: 'not_found', rejectedCode };
  if (facts.outside.has(sha)) return { cite, status: 'out_of_range', basis: 'outside_shas' };
  if (facts.boundaryParents.has(sha)) return { cite, status: 'out_of_range', basis: 'boundary_parent' };
  return { cite, status: 'not_found', rejectedCode: null };
}

/** Distinct known shas (cached per facts object). */
const knownCache = new WeakMap<object, string[]>();

function knownShas(ctx: ResolveContext): string[] {
  const cached = knownCache.get(ctx.facts);
  if (cached !== undefined) return cached;
  const { facts } = ctx;
  const all = new Set<string>([...facts.commits.keys(), ...facts.rejected.keys(), ...facts.outside, ...facts.boundaryParents]);
  const list = [...all];
  knownCache.set(ctx.facts, list);
  return list;
}

/** Human-readable evidence line for one resolution; code-generated, never commit text. */
export function describeResolution(r: CiteResolution): string {
  const cite = citeLabel(r.cite);
  switch (r.status) {
    case 'resolved':
      return r.active ? `${cite}: resolved to ${r.sha}` : `${cite}: resolved to ${r.sha}, cancelled by a revert in range`;
    case 'not_found':
      return r.rejectedCode === null ? `${cite}: no such commit in the input` : `${cite}: commit rejected at parse: ${r.rejectedCode}`;
    case 'ambiguous':
      return `${cite}: prefix matches ${r.candidates.length} commits`;
    case 'out_of_range':
      return r.basis === 'not_in_request'
        ? `${cite}: not in request input`
        : r.basis === 'outside_shas'
          ? `${cite}: declared outside the range (outside_shas)`
          : `${cite}: boundary parent outside the range`;
  }
}

/** A cite as shown in evidence: hex only; anything else is not echoed. */
function citeLabel(raw: string): string {
  const text = raw.trim().toLowerCase();
  return /^[0-9a-f]{1,64}$/.test(text) ? text : '(malformed cite)';
}
