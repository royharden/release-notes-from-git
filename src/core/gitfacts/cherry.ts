// Cherry-pick collapse, conservative (PLAN §2 #12): only an explicit `(cherry picked from commit <full sha>)`
// trailer whose sha is an accepted in-range commit collapses the pick into its source's unit. Same subject and
// same paths without that trailer stay two units and get a `possible_duplicate_unit` warning instead
// (`t_same_subject_distinct`).

import { normaliseText } from '../rulings/key.ts';

const CHERRY_TRAILER = /^[ \t]*\(cherry picked from commit ([0-9a-fA-F]{40}|[0-9a-fA-F]{64})\)[ \t]*$/m;

/** The full source sha named by the trailer, lower-cased, or null. */
export function cherrySource(body: string): string | null {
  const match = CHERRY_TRAILER.exec(body);
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

/** Signature used for the possible-duplicate warning: normalised subject plus the sorted path set. */
export function duplicateSignature(subject: string, paths: readonly string[]): string {
  return `${normaliseText(subject)}\n${[...new Set(paths)].sort().join('\n')}`;
}
