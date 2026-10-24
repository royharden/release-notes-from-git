// groupUnits(facts) -> change units: one per PR group or standalone commit, in topological order.
//
// Grouping, in this order (each commit joins at most one unit):
// 1. Merge PR: a merge whose subject is `Merge pull request #N` groups itself with the in-range commits reachable
//    only through its second parent (ancestors of parent 2 minus ancestors of parent 1). The merge envelope is a
//    member of that unit, not a separate unit.
// 2. Squash PR: non-merge commits whose subject ends `(#N)` group by N.
// 3. Cherry-pick: a commit with an explicit trailer naming an accepted source joins the source's unit.
// 4. Everything else is standalone (rebase merges carry no PR id, so each commit is its own unit).
// `Fixes/Closes/Resolves #N` never groups. More than LIMITS.maxUnits units rejects the run (no truncation).

import { LIMITS } from '../../../supabase/functions/_shared/core/limits.ts';
import { UNKNOWN_TYPE } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { NoiseReason, RevertState, WireUnit } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { IgnoreConfig } from '../config.ts';
import { DEFAULT_IGNORE } from '../config.ts';
import { duplicateSignature } from './cherry.ts';
import { parseConventional } from './conventional.ts';
import type { CommitFact, FactIndex } from './facts.ts';
import { inRangeAncestors } from './facts.ts';
import { isIgnoredType, touchesProductPath } from './noise.ts';

/** A change unit before chunking. */
export type UnitDraft = Omit<WireUnit, 'chunk_index'>;

export type UnitsResult =
  | {
      ok: true;
      units: UnitDraft[];
      /** unit_keys sharing a subject+paths signature with another unit and no cherry-pick trailer. */
      possibleDuplicates: ReadonlySet<string>;
    }
  | { ok: false; code: 'too_many_units'; unitCount: number; limit: number };

/** Types that name a product change, in the priority used to pick a group's type. */
const PRODUCT_TYPE_PRIORITY = ['feat', 'fix', 'perf'] as const;

export function prUnitKey(pr: number): string {
  return `pr-${pr}`;
}

export function commitUnitKey(sha: string): string {
  return `c-${sha}`;
}

export function groupUnits(facts: FactIndex, ignore: IgnoreConfig = DEFAULT_IGNORE): UnitsResult {
  const unitOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  const mergeHeadline = new Map<string, string>();
  const join = (key: string, sha: string): void => {
    if (unitOf.has(sha)) return;
    unitOf.set(sha, key);
    const list = members.get(key);
    if (list === undefined) members.set(key, [sha]);
    else list.push(sha);
  };

  // 1. Merge PRs, in topological order so an earlier merge claims its commits first.
  for (const sha of facts.order) {
    const fact = facts.commits.get(sha) as CommitFact;
    if (!fact.isMerge || fact.prVia !== 'merge' || fact.prNumber === null) continue;
    const key = prUnitKey(fact.prNumber);
    const [first, second] = fact.parents;
    if (second !== undefined) {
      const mainline = first === undefined ? new Set<string>() : inRangeAncestors(first, facts);
      for (const branchSha of inRangeAncestors(second, facts)) if (!mainline.has(branchSha)) join(key, branchSha);
    }
    join(key, sha);
    const headline = firstLine(fact.body);
    if (headline !== '' && !mergeHeadline.has(key)) mergeHeadline.set(key, headline);
  }
  // 2. Squash PRs.
  for (const sha of facts.order) {
    const fact = facts.commits.get(sha) as CommitFact;
    if (fact.prVia === 'squash' && fact.prNumber !== null) join(prUnitKey(fact.prNumber), sha);
  }
  // 3. Explicit cherry-picks follow their source.
  for (const sha of facts.order) {
    const fact = facts.commits.get(sha) as CommitFact;
    if (unitOf.has(sha) || fact.cherrySource === null) continue;
    const source = fact.cherrySource;
    if (!unitOf.has(source)) join(commitUnitKey(source), source);
    join(unitOf.get(source) as string, sha);
  }
  // 4. Standalone.
  for (const sha of facts.order) if (!unitOf.has(sha)) join(commitUnitKey(sha), sha);

  if (members.size > LIMITS.maxUnits) {
    return { ok: false, code: 'too_many_units', unitCount: members.size, limit: LIMITS.maxUnits };
  }

  const drafts = [...members].map(([key, shas]) => {
    const ordered = shas
      .map((sha) => facts.commits.get(sha) as CommitFact)
      .sort((a, b) => a.order - b.order);
    return { first: ordered[0]?.order ?? 0, unit: buildUnit(key, ordered, mergeHeadline.get(key) ?? null, ignore) };
  });
  drafts.sort((a, b) => a.first - b.first);
  const units = drafts.map(({ unit }, ordinal) => ({ ...unit, ordinal }));
  return { ok: true, units, possibleDuplicates: findPossibleDuplicates(units) };
}

function buildUnit(key: string, commits: CommitFact[], headline: string | null, ignore: IgnoreConfig): UnitDraft {
  const single = commits.length === 1 ? commits[0] : undefined;
  const typeSource = pickTypeSource(commits, headline);
  const type = typeSource?.type ?? UNKNOWN_TYPE;
  const breaking = commits.some((c) => c.breaking) || (headline !== null && parseConventional(headline, '').bang);
  const pr = commits.find((c) => c.prNumber !== null)?.prNumber ?? null;
  let noise: NoiseReason | null;
  if (single !== undefined) noise = single.noise;
  else noise = isIgnoredType(type, ignore) && !breaking ? 'ignored_type' : null;
  return {
    ordinal: 0,
    unit_key: key,
    shas: commits.map((c) => c.sha),
    pr_number: pr,
    type,
    scope: typeSource?.scope ?? null,
    breaking,
    subjects: commits.map((c) => c.subject),
    body: commits
      .map((c) => c.body)
      .filter((b) => b.trim() !== '')
      .join('\n\n'),
    paths: [...new Set(commits.flatMap((c) => c.paths))],
    noise_reason: noise,
    revert_state: unitRevertState(commits),
  };
}

/** The merge headline first (a GitHub merge body starts with the PR title), then members in order. */
function pickTypeSource(commits: CommitFact[], headline: string | null): { type: string; scope: string | null } | null {
  const candidates: { type: string; scope: string | null }[] = [];
  if (headline !== null) {
    const parsed = parseConventional(headline, '');
    if (parsed.type !== UNKNOWN_TYPE) candidates.push(parsed);
  }
  for (const c of commits) if (c.typed && !c.isMerge) candidates.push(c.conventional);
  for (const wanted of PRODUCT_TYPE_PRIORITY) {
    const hit = candidates.find((c) => c.type === wanted);
    if (hit !== undefined) return hit;
  }
  return candidates[0] ?? null;
}

function unitRevertState(commits: CommitFact[]): RevertState {
  if (commits.every((c) => c.revertState === 'cancelled')) return 'cancelled';
  if (commits.length === 1) return (commits[0] as CommitFact).revertState;
  return 'active';
}

function findPossibleDuplicates(units: readonly UnitDraft[]): Set<string> {
  const bySignature = new Map<string, string[]>();
  for (const unit of units) {
    if (unit.shas.length !== 1 || unit.noise_reason !== null) continue;
    const signature = duplicateSignature(unit.subjects[0] ?? '', unit.paths);
    const list = bySignature.get(signature);
    if (list === undefined) bySignature.set(signature, [unit.unit_key]);
    else list.push(unit.unit_key);
  }
  const flagged = new Set<string>();
  for (const keys of bySignature.values()) if (keys.length > 1) for (const key of keys) flagged.add(key);
  return flagged;
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();
}

/** Units whose changes the validator treats as product changes worth a bullet (Uncovered candidates). */
export function isUncoveredEligible(unit: UnitDraft, ignore: IgnoreConfig = DEFAULT_IGNORE): boolean {
  if (unit.noise_reason !== null || unit.revert_state === 'cancelled') return false;
  if (unit.breaking) return true;
  if ((PRODUCT_TYPE_PRIORITY as readonly string[]).includes(unit.type)) return true;
  return unit.type === UNKNOWN_TYPE && touchesProductPath(unit.paths, ignore.nonProductPaths);
}

export interface UncoveredUnits {
  /** feat/fix/perf or breaking units no kept bullet cites. */
  typed: UnitDraft[];
  /** `unknown` units touching a product path that no kept bullet cites. */
  untyped: UnitDraft[];
}

/** Eligible units none of whose shas is cited (as a resolved full sha) by a kept bullet. */
export function uncoveredUnits(
  units: readonly UnitDraft[],
  keptCitedShas: ReadonlySet<string>,
  ignore: IgnoreConfig = DEFAULT_IGNORE,
): UncoveredUnits {
  const out: UncoveredUnits = { typed: [], untyped: [] };
  for (const unit of units) {
    if (!isUncoveredEligible(unit, ignore)) continue;
    if (unit.shas.some((sha) => keptCitedShas.has(sha))) continue;
    (unit.type === UNKNOWN_TYPE ? out.untyped : out.typed).push(unit);
  }
  return out;
}

export interface UnitSummary {
  units: number;
  commits: number;
  noise: Record<NoiseReason, number>;
  cancelledUnits: number;
  prUnits: number;
  typedUnits: number;
  untypedUnits: number;
}

/** Counts for the Internal tab. */
export function summarizeUnits(units: readonly UnitDraft[]): UnitSummary {
  const noise: Record<NoiseReason, number> = {
    merge_without_pr: 0,
    fixup: 0,
    squash: 0,
    amend: 0,
    wip: 0,
    ignored_type: 0,
  };
  for (const unit of units) if (unit.noise_reason !== null) noise[unit.noise_reason]++;
  return {
    units: units.length,
    commits: units.reduce((n, u) => n + u.shas.length, 0),
    noise,
    cancelledUnits: units.filter((u) => u.revert_state === 'cancelled').length,
    prUnits: units.filter((u) => u.pr_number !== null).length,
    typedUnits: units.filter((u) => u.type !== UNKNOWN_TYPE).length,
    untypedUnits: units.filter((u) => u.type === UNKNOWN_TYPE).length,
  };
}
