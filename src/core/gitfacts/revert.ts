// Revert pairing in parent-graph topological order (PLAN §2 #6), never by timestamp.
//
// Target lookup: `This reverts commit <sha>` (full sha, or a >= 7-char prefix unique among in-range commits), else
// `Revert "<subject>"` matched to exactly one earlier in-range subject. A target must come earlier in the order.
// An ambiguous subject is surfaced (target_ambiguous), never guessed; a target that is not an earlier in-range
// commit leaves the revert visible (target_outside_range, "original not in range").
//
// Net state over a chain X0 <- X1 <- ... <- Xn (Xi reverts Xi-1): every revert X1..Xn is cancelled; X0 is cancelled
// when n is odd and keeps its own state when n is even. So A + R1(A) cancels both, and A + R1(A) + R2(R1) leaves A
// live with R1 and R2 cancelled. A second revert of an already-reverted commit is not paired (listed as an issue).

import { LIMITS } from '../../../supabase/functions/_shared/core/limits.ts';
import type { RevertState } from '../../../supabase/functions/_shared/core/units-wire.ts';

const REVERTS_SHA = /This reverts commit ([0-9a-fA-F]{7,64})\b/;
/** Greedy, so `Revert "Revert "x""` captures `Revert "x"`. */
const REVERT_SUBJECT = /^Revert "(.+)"\s*$/;

export interface RevertInput {
  sha: string;
  subject: string;
  body: string;
}

export type RevertVia = 'sha' | 'subject';

export interface RevertInfo {
  via: RevertVia;
  /** In-range target sha when paired or resolvable; null otherwise. */
  target: string | null;
  /** Candidate shas when the subject (or prefix) matched several commits. */
  candidates: string[];
  /** Why the revert is not paired, when it is not. */
  unpaired: 'target_not_in_range' | 'target_not_earlier' | 'target_ambiguous' | 'target_already_reverted' | null;
}

export interface RevertIssue {
  sha: string;
  issue: NonNullable<RevertInfo['unpaired']>;
  candidates: string[];
}

export interface RevertResult {
  /** Revert metadata for every commit that is a revert. */
  reverts: Map<string, RevertInfo>;
  /** Net state of every commit. */
  states: Map<string, RevertState>;
  /** Each paired chain root-first: [X0, X1, ...]. */
  chains: string[][];
  issues: RevertIssue[];
}

/** Detects whether a commit is a revert and how it names its target (no resolution). */
export function detectRevert(subject: string, body: string): { via: RevertVia; ref: string } | null {
  const bySha = REVERTS_SHA.exec(body) ?? REVERTS_SHA.exec(subject);
  if (bySha?.[1] !== undefined) return { via: 'sha', ref: bySha[1].toLowerCase() };
  const bySubject = REVERT_SUBJECT.exec(subject.trim());
  if (bySubject?.[1] !== undefined) return { via: 'subject', ref: bySubject[1] };
  return null;
}

/** `ordered` must be the commits in topological order (parents first, ties by sha). */
export function pairReverts(ordered: readonly RevertInput[]): RevertResult {
  const position = new Map<string, number>();
  ordered.forEach((c, i) => position.set(c.sha, i));
  const reverts = new Map<string, RevertInfo>();
  const states = new Map<string, RevertState>();
  for (const c of ordered) states.set(c.sha, 'active');

  const revertedBy = new Map<string, string>();
  const pairedTarget = new Map<string, string>();
  const issues: RevertIssue[] = [];

  ordered.forEach((commit, index) => {
    const detected = detectRevert(commit.subject, commit.body);
    if (detected === null) return;
    const info = resolveTarget(detected, commit.sha, index, ordered, position);
    if (info.unpaired === null && info.target !== null) {
      if (revertedBy.has(info.target)) {
        info.unpaired = 'target_already_reverted';
      } else {
        revertedBy.set(info.target, commit.sha);
        pairedTarget.set(commit.sha, info.target);
      }
    }
    reverts.set(commit.sha, info);
    if (info.unpaired !== null) {
      issues.push({ sha: commit.sha, issue: info.unpaired, candidates: [...info.candidates] });
      if (info.unpaired === 'target_ambiguous') states.set(commit.sha, 'target_ambiguous');
      else if (info.unpaired !== 'target_already_reverted') states.set(commit.sha, 'target_outside_range');
    }
  });

  // Chains start at a commit that is reverted but is not itself a paired revert.
  const chains: string[][] = [];
  for (const c of ordered) {
    if (!revertedBy.has(c.sha) || pairedTarget.has(c.sha)) continue;
    const chain = [c.sha];
    let next = revertedBy.get(c.sha);
    while (next !== undefined) {
      chain.push(next);
      next = revertedBy.get(next);
    }
    chains.push(chain);
    const n = chain.length - 1;
    for (const sha of chain.slice(1)) states.set(sha, 'cancelled');
    if (n % 2 === 1) states.set(c.sha, 'cancelled');
  }
  return { reverts, states, chains, issues };
}

function resolveTarget(
  detected: { via: RevertVia; ref: string },
  self: string,
  index: number,
  ordered: readonly RevertInput[],
  position: ReadonlyMap<string, number>,
): RevertInfo {
  const fromCandidates = (candidates: string[]): RevertInfo => {
    if (candidates.length === 0) return { via: detected.via, target: null, candidates: [], unpaired: 'target_not_in_range' };
    if (candidates.length > 1) return { via: detected.via, target: null, candidates, unpaired: 'target_ambiguous' };
    const target = candidates[0] as string;
    const at = position.get(target) ?? Number.POSITIVE_INFINITY;
    if (at >= index) return { via: detected.via, target, candidates: [], unpaired: 'target_not_earlier' };
    return { via: detected.via, target, candidates: [], unpaired: null };
  };

  if (detected.via === 'sha') {
    if (detected.ref.length < LIMITS.minCitePrefix) return fromCandidates([]);
    const matches = ordered.filter((c) => c.sha !== self && c.sha.startsWith(detected.ref)).map((c) => c.sha);
    return fromCandidates(matches);
  }
  // Subject form: only earlier commits are candidates, so a later commit with the same subject cannot make an
  // otherwise unique match ambiguous.
  const matches = ordered
    .slice(0, index)
    .filter((c) => c.subject.trim() === detected.ref)
    .map((c) => c.sha);
  return fromCandidates(matches);
}
