// Seeded, offline Part A mutations. Preconditions describe the planted change, not a semantic truth label.
import { LIMITS, codePointLength } from '../supabase/functions/_shared/core/limits.ts';
import { collectEvidence, hasBreakingMarker } from '../src/core/validate/evidence.ts';
import type { FactIndex } from '../src/core/gitfacts/facts.ts';
import type { BulletInput, ReasonCode } from '../src/core/validate/reasons.ts';
import { missingLiterals } from '../src/core/support/literals.ts';

export const OPERATORS = ['swap_cite', 'phantom_sha', 'outside_range_sha', 'invent_literal', 'splice_claim', 'inflate_breaking', 'no_citation'] as const;
export type Operator = (typeof OPERATORS)[number];
export interface GenuineEntry { id: string; bullet: BulletInput; pr_number: number | null }
export interface MutationAttempt {
  operator: Operator;
  source: string;
  precondition: string;
  eligible: boolean;
  skip: string | null;
  bullet: BulletInput | null;
  expectedReason: ReasonCode | null;
  /** null means report-only; these are proposed bars, never claimed successes. */
  target: number | null;
}

/** Mulberry32; integer seed and sorted candidate lists make replay independent of Map insertion order. */
export function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be uint32');
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function mutate(
  operator: Operator, source: GenuineEntry, entries: readonly GenuineEntry[], facts: FactIndex,
  unitBySha: ReadonlyMap<string, string>, random: () => number,
): MutationAttempt {
  const expected: Record<Operator, ReasonCode | null> = {
    swap_cite: null, phantom_sha: 'cite_not_found', outside_range_sha: 'cite_out_of_range',
    invent_literal: 'literal_not_in_evidence', splice_claim: null, inflate_breaking: 'category_unsupported', no_citation: 'no_citation',
  };
  const targets: Record<Operator, number | null> = {
    swap_cite: null, phantom_sha: 1, outside_range_sha: 1, invent_literal: 0.9,
    splice_claim: null, inflate_breaking: 1, no_citation: 1,
  };
  const descriptions: Record<Operator, string> = {
    swap_cite: 'active evidence; replacement is in another unit and PR (semantic unrelatedness unverified)',
    phantom_sha: 'active evidence; replacement sha is absent from accepted, rejected and known outside sets',
    outside_range_sha: 'active evidence; replacement is a declared outside sha or known boundary parent',
    invent_literal: 'active evidence; original literals present; appended version absent verbatim; length <=240',
    splice_claim: 'active evidence; donor text and unit differ; disjoint cites; combined length <=240',
    inflate_breaking: 'all cites resolve active in-range; no breaking marker; original literals present; length <=240',
    no_citation: 'active evidence; all citations removed',
  };
  const result: MutationAttempt = { operator, source: source.id, precondition: descriptions[operator], eligible: false,
    skip: null, bullet: null, expectedReason: expected[operator], target: targets[operator] };
  const skip = (why: string): MutationAttempt => ({ ...result, skip: why });
  const evidence = collectEvidence(source.bullet.cites, { facts });
  if (source.bullet.cites.length === 0 || evidence.resolutions.some((r) => r.status !== 'resolved' || !r.active)) return skip('source_cites_not_all_active_in_range');
  if (codePointLength(source.bullet.text) > LIMITS.maxBulletChars) return skip('source_too_long');
  const bullet = structuredClone(source.bullet);
  const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)];
  const sourceUnits = new Set(evidence.activeShas.map((sha) => unitBySha.get(sha)));
  switch (operator) {
    case 'swap_cite': {
      const candidates = [...facts.commits.values()].filter((f) => f.active && f.noise === null &&
        !sourceUnits.has(unitBySha.get(f.sha)) && !evidence.activeShas.includes(f.sha) &&
        (source.pr_number === null || f.prNumber !== source.pr_number)).map((f) => f.sha).sort();
      const replacement = pick(candidates);
      if (replacement === undefined) return skip('no_other_active_unit');
      bullet.cites = [replacement];
      break;
    }
    case 'phantom_sha': {
      const known = new Set([...facts.commits.keys(), ...facts.rejected.keys(), ...facts.outside, ...facts.boundaryParents]);
      let replacement = '';
      for (let attempt = 0; attempt < 100; attempt++) {
        replacement = Array.from({ length: 40 }, () => Math.floor(random() * 16).toString(16)).join('');
        if (!known.has(replacement)) break;
      }
      if (known.has(replacement)) return skip('could_not_construct_absent_sha');
      bullet.cites = [replacement];
      break;
    }
    case 'outside_range_sha': {
      const replacement = pick([...new Set([...facts.outside, ...facts.boundaryParents])]
        .filter((sha) => !facts.commits.has(sha) && !facts.rejected.has(sha)).sort());
      if (replacement === undefined) return skip('no_known_outside_sha');
      bullet.cites = [replacement];
      break;
    }
    case 'invent_literal': {
      if (missingLiterals(bullet.text, evidence.text).length > 0) return skip('source_has_missing_literal');
      let literal = '';
      for (let attempt = 0; attempt < 100; attempt++) {
        literal = `v937.${Math.floor(random() * 1000000)}.0`;
        if (!evidence.text.normalize('NFC').includes(literal)) break;
      }
      if (evidence.text.normalize('NFC').includes(literal)) return skip('no_absent_literal');
      bullet.text += ` ${literal}`;
      break;
    }
    case 'splice_claim': {
      const donors = entries.filter((e) => e.id !== source.id && e.bullet.text !== bullet.text &&
        e.bullet.cites.every((sha) => facts.commits.get(sha)?.active && !sourceUnits.has(unitBySha.get(sha))) &&
        e.bullet.cites.length > 0 && codePointLength(`${bullet.text} ${e.bullet.text}`) <= LIMITS.maxBulletChars)
        .sort((a, b) => a.id.localeCompare(b.id, 'en'));
      const donor = pick(donors);
      if (donor === undefined) return skip('no_disjoint_donor_within_length');
      bullet.text += ` ${donor.bullet.text}`;
      break;
    }
    case 'inflate_breaking':
      if (bullet.category === 'breaking' || hasBreakingMarker(evidence.activeShas, facts)) return skip('active_cited_evidence_has_breaking_marker');
      if (missingLiterals(bullet.text, evidence.text).length > 0) return skip('source_has_missing_literal');
      bullet.category = 'breaking';
      break;
    case 'no_citation': bullet.cites = []; break;
  }
  if (codePointLength(bullet.text) > LIMITS.maxBulletChars) return skip('mutation_too_long');
  return { ...result, eligible: true, bullet };
}
