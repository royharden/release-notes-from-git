// Persisted change-unit shape: what the browser inserts into run_units and what the edge function reads back
// after seal_run. Prompt size is always derived from the text fields by promptChars(); no stored count is trusted.

import { LIMITS, codePointLength, sliceCodePoints } from './limits.ts';

/** Type of a commit with no conventional-commit prefix. The ignore list never applies to it. */
export const UNKNOWN_TYPE = 'unknown';

export const REVERT_STATES = [
  'active', // not reverted, or reactivated by a revert of its revert
  'cancelled', // reverted within the range (both commits of the pair)
  'target_outside_range', // a revert whose original is not in the range; stays visible
  'target_ambiguous', // `Revert "<subject>"` matched more than one in-range subject; surfaced, never guessed
] as const;
export type RevertState = (typeof REVERT_STATES)[number];

export const NOISE_REASONS = ['merge_without_pr', 'fixup', 'squash', 'amend', 'wip', 'ignored_type'] as const;
export type NoiseReason = (typeof NOISE_REASONS)[number];

export interface WireUnit {
  /** Position in parent-graph topological order (ties by sha), from 0. */
  ordinal: number;
  unit_key: string;
  /** Full shas of the unit's commits, in ordinal order. */
  shas: string[];
  pr_number: number | null;
  /** Conventional type, or UNKNOWN_TYPE. */
  type: string;
  scope: string | null;
  breaking: boolean;
  subjects: string[];
  /** Accepted (redacted) bodies of the unit's commits joined by a blank line. Never truncated. */
  body: string;
  paths: string[];
  noise_reason: NoiseReason | null;
  revert_state: RevertState;
  /** Proposed by the client, re-verified by seal_run (see PLAN §2 #9). */
  chunk_index: number;
}

export const WIRE_UNIT_FIELDS = [
  'ordinal',
  'unit_key',
  'shas',
  'pr_number',
  'type',
  'scope',
  'breaking',
  'subjects',
  'body',
  'paths',
  'noise_reason',
  'revert_state',
  'chunk_index',
] as const satisfies readonly (keyof WireUnit)[];

export type PromptTextFields = Pick<WireUnit, 'subjects' | 'body' | 'paths'>;

/** The prompt-only body excerpt: first promptBodyExcerptChars code points. */
export function excerptBody(body: string): { text: string; truncated: boolean } {
  const text = sliceCodePoints(body, LIMITS.promptBodyExcerptChars);
  return { text, truncated: text.length < body.length };
}

/**
 * The unit text as it is measured for chunking: subjects, excerpted body and paths, each list joined by "\n",
 * the three parts joined by "\n". SQL equivalent used by seal_run:
 *   char_length(array_to_string(subjects, E'\n') || E'\n' || left(body, 1500) || E'\n' || array_to_string(paths, E'\n'))
 */
export function promptText(unit: PromptTextFields): string {
  return [unit.subjects.join('\n'), excerptBody(unit.body).text, unit.paths.join('\n')].join('\n');
}

/** Prompt characters of a unit, in code points. The only source of a unit's size for chunking and seal checks. */
export function promptChars(unit: PromptTextFields): number {
  return codePointLength(promptText(unit));
}

/** True when the prompt excerpt shortened the body (the `prompt_truncated` flag; stored evidence is unaffected). */
export function promptTruncated(unit: Pick<WireUnit, 'body'>): boolean {
  return excerptBody(unit.body).truncated;
}
