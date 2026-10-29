// buildFacts(log) -> FactIndex: per accepted commit (by full sha) its conventional fields, PR number, issue refs,
// revert target and net state, noise reason and cherry-pick source, plus the sets the citation resolver needs
// (rejected record shas, declared outside shas, boundary parents). Order is parent-graph topological, ties by sha.

import type { NoiseReason, RevertState } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { IgnoreConfig } from '../config.ts';
import { DEFAULT_IGNORE } from '../config.ts';
import type { RejectCode, SanitizedCommit, SanitizedLog } from '../gitlog/schema.ts';
import { cherrySource } from './cherry.ts';
import { isBreaking, isTyped, parseConventional } from './conventional.ts';
import type { ConventionalFields } from './conventional.ts';
import { noiseReason } from './noise.ts';
import { issueRefs, mergePrNumber, squashPrNumber } from './pr.ts';
import { pairReverts } from './revert.ts';
import type { RevertInfo, RevertIssue } from './revert.ts';

export interface CommitFact {
  sha: string;
  /** All parents as supplied, including ones outside the accepted set. */
  parents: string[];
  date: string;
  subject: string;
  body: string;
  paths: string[];
  /** Position in topological order. */
  order: number;
  isMerge: boolean;
  conventional: ConventionalFields;
  /** Conventional type or UNKNOWN_TYPE (shortcut for conventional.type). */
  type: string;
  typed: boolean;
  /** `!` or a breaking footer. */
  breaking: boolean;
  prNumber: number | null;
  prVia: 'squash' | 'merge' | null;
  issueRefs: number[];
  revert: RevertInfo | null;
  revertState: RevertState;
  /** active = evidence the validator may read: not cancelled by an in-range revert. */
  active: boolean;
  noise: NoiseReason | null;
  /** Source sha of an explicit cherry-pick trailer naming an accepted commit; null otherwise. */
  cherrySource: string | null;
}

export interface FactIndex {
  commits: ReadonlyMap<string, CommitFact>;
  /** Accepted shas in topological order. */
  order: readonly string[];
  /** Rejected records that kept a well-formed sha -> their reject code. */
  rejected: ReadonlyMap<string, RejectCode>;
  /** Declared outside shas (outside_shas). */
  outside: ReadonlySet<string>;
  /** Parents of accepted commits that are neither accepted nor rejected: known boundary commits. */
  boundaryParents: ReadonlySet<string>;
  /** Paired revert chains, root first. */
  revertChains: readonly (readonly string[])[];
  /** Reverts left unpaired, with why (ambiguous subject, original not in range, ...). */
  revertIssues: readonly RevertIssue[];
}

export function buildFacts(log: SanitizedLog, ignore: IgnoreConfig = DEFAULT_IGNORE): FactIndex {
  const order = topologicalOrder(log.commits);
  const bySha = new Map(log.commits.map((c) => [c.sha, c]));
  const orderedCommits = order.map((sha) => bySha.get(sha) as SanitizedCommit);
  const reverts = pairReverts(orderedCommits.map((c) => ({ sha: c.sha, subject: c.subject, body: c.body })));

  const commits = new Map<string, CommitFact>();
  orderedCommits.forEach((c, index) => {
    const conventional = parseConventional(c.subject, c.body);
    const isMerge = c.parents.length > 1;
    const merge = isMerge ? mergePrNumber(c.subject) : null;
    const squash = isMerge ? null : squashPrNumber(c.subject);
    const prNumber = merge ?? squash;
    const revertState = reverts.states.get(c.sha) ?? 'active';
    const source = cherrySource(c.body);
    commits.set(c.sha, {
      sha: c.sha,
      parents: [...c.parents],
      date: c.date,
      subject: c.subject,
      body: c.body,
      paths: c.files.map((f) => f.path),
      order: index,
      isMerge,
      conventional,
      type: conventional.type,
      typed: isTyped(conventional),
      breaking: isBreaking(conventional),
      prNumber,
      prVia: merge !== null ? 'merge' : squash !== null ? 'squash' : null,
      issueRefs: issueRefs(c.subject, c.body),
      revert: reverts.reverts.get(c.sha) ?? null,
      revertState,
      active: revertState !== 'cancelled',
      noise: noiseReason({ subject: c.subject, type: conventional.type, isMerge, prNumber }, ignore),
      cherrySource: source !== null && source !== c.sha && bySha.has(source) ? source : null,
    });
  });

  const rejected = new Map<string, RejectCode>();
  for (const r of log.rejected) if (r.sha !== undefined && !bySha.has(r.sha)) rejected.set(r.sha, r.code);
  const outside = new Set(log.outside_shas);
  const boundaryParents = new Set<string>();
  for (const c of log.commits) {
    for (const p of c.parents) if (!bySha.has(p) && !rejected.has(p)) boundaryParents.add(p);
  }
  return {
    commits,
    order,
    rejected,
    outside,
    boundaryParents,
    revertChains: reverts.chains,
    revertIssues: reverts.issues,
  };
}

/**
 * Kahn's algorithm over in-range parent edges: a commit comes after every accepted parent; among commits that
 * are ready at the same time the smallest sha goes first. Parents outside the accepted set impose no edge. A cycle
 * (impossible in git, possible in a hand-written file) leaves its commits appended in sha order.
 */
export function topologicalOrder(commits: readonly { sha: string; parents: readonly string[] }[]): string[] {
  const known = new Set(commits.map((c) => c.sha));
  const pending = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const c of commits) {
    const inRange = [...new Set(c.parents)].filter((p) => known.has(p));
    pending.set(c.sha, inRange.length);
    for (const p of inRange) {
      const list = children.get(p);
      if (list === undefined) children.set(p, [c.sha]);
      else list.push(c.sha);
    }
  }
  const ready = [...pending].filter(([, n]) => n === 0).map(([sha]) => sha).sort();
  const out: string[] = [];
  while (ready.length > 0) {
    const sha = ready.shift() as string;
    out.push(sha);
    for (const child of children.get(sha) ?? []) {
      const n = (pending.get(child) ?? 0) - 1;
      pending.set(child, n);
      if (n === 0) insertSorted(ready, child);
    }
  }
  if (out.length < commits.length) {
    const placed = new Set(out);
    out.push(...commits.map((c) => c.sha).filter((sha) => !placed.has(sha)).sort());
  }
  return out;
}

function insertSorted(list: string[], value: string): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as string) < value) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, value);
}

/** Accepted shas reachable from `start` through in-range parents, inclusive of `start` when accepted. */
export function inRangeAncestors(start: string, facts: Pick<FactIndex, 'commits'>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const sha = stack.pop() as string;
    if (seen.has(sha)) continue;
    const fact = facts.commits.get(sha);
    if (fact === undefined) continue;
    seen.add(sha);
    for (const p of fact.parents) stack.push(p);
  }
  return seen;
}

/** Text the validator reads for one commit: subject, body and paths joined by newlines. */
export function commitEvidenceText(fact: Pick<CommitFact, 'subject' | 'body' | 'paths'>): string {
  return [fact.subject, fact.body, ...fact.paths].join('\n');
}
