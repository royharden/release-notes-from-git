// Reason codes, warning codes and the verdict/evidence shapes the validator (M2) produces and the export gate,
// review UI and eval consume. Declared in M1 so later milestones reconcile against one definition.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import type { RejectCode } from '../gitlog/schema.ts';

/** Evaluation order (PLAN §3.2): the first failing code is the verdict's reason; all failing codes are listed. */
export const REASON_CODES = [
  'no_citation',
  'cite_not_found',
  'cite_ambiguous',
  'cite_out_of_range',
  'reverted_in_range',
  'too_long',
  'literal_not_in_evidence',
  'category_unsupported',
  'low_support',
  'duplicate_of',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Hard reasons cannot be restored; their citations must be repaired by an edit first. */
export const HARD_REASONS = [
  'no_citation',
  'cite_not_found',
  'cite_ambiguous',
  'cite_out_of_range',
  'reverted_in_range',
] as const satisfies readonly ReasonCode[];
export const SOFT_REASONS = [
  'too_long',
  'literal_not_in_evidence',
  'category_unsupported',
  'low_support',
  'duplicate_of',
] as const satisfies readonly ReasonCode[];
export type HardReason = (typeof HARD_REASONS)[number];
export type SoftReason = (typeof SOFT_REASONS)[number];

const HARD_SET: ReadonlySet<ReasonCode> = new Set(HARD_REASONS);

export function isHardReason(reason: ReasonCode): reason is HardReason {
  return HARD_SET.has(reason);
}

export function isSoftReason(reason: ReasonCode): reason is SoftReason {
  return !HARD_SET.has(reason);
}

/** Non-dropping warnings. */
export const WARNING_CODES = ['category_mismatch', 'possible_duplicate_unit'] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** How one cite of a bullet resolved against the fact table. */
export type CiteResolution =
  | { cite: string; status: 'resolved'; sha: string; active: boolean }
  /** Unknown sha, or a record rejected at parse (then `rejectedCode` is set: "commit rejected at parse: <code>"). */
  | { cite: string; status: 'not_found'; rejectedCode: RejectCode | null }
  | { cite: string; status: 'ambiguous'; candidates: string[] }
  /** Declared outside (outside_shas or a boundary parent), or not in the request's input. */
  | { cite: string; status: 'out_of_range'; basis: 'outside_shas' | 'boundary_parent' | 'not_in_request' };

export interface Evidence {
  cites: CiteResolution[];
  /** Full shas of resolved, active (not cancelled) cited commits: the evidence the checks read. */
  activeShas: string[];
  /** Resolved cited commits excluded from evidence because a revert cancelled them in range. */
  cancelledShas: string[];
  /** Literals in the bullet absent verbatim (after NFC) from active cited subject/body/paths. */
  missingLiterals: string[];
  /** Content tokens found / not found in the active evidence (support score inputs, highlight terms). */
  matchedTerms: string[];
  unmatchedTerms: string[];
  /** Content key of the earlier bullet this one duplicates. */
  duplicateOf: string | null;
  /** Short code-generated explanations, one per failing check. Never model or commit text. */
  notes: string[];
}

export function emptyEvidence(): Evidence {
  return {
    cites: [],
    activeShas: [],
    cancelledShas: [],
    missingLiterals: [],
    matchedTerms: [],
    unmatchedTerms: [],
    duplicateOf: null,
    notes: [],
  };
}

export interface Verdict {
  kept: boolean;
  /** First failing reason in REASON_CODES order; null when kept. */
  reason: ReasonCode | null;
  /** Every failing reason, in REASON_CODES order. */
  reasons: ReasonCode[];
  warnings: WarningCode[];
  evidence: Evidence;
  /** found/total content tokens; null when support was not evaluated (a hard reason failed first). */
  support_score: number | null;
}

/** What the validator reads from a bullet. */
export interface BulletInput {
  text: string;
  category: Category;
  cites: string[];
}

/** validateAll as the export gate and UI consume it: context (facts, thresholds) bound by the caller. */
export type ValidateFn = (bullets: readonly BulletInput[]) => Verdict[];
