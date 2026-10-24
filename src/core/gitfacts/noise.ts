// Noise: merges without a PR id, `fixup!` / `squash!` / `amend!`, a `WIP` prefix, and typed commits whose type is
// on the editable ignore list (config/ignore.json). Noise is counted in Internal and never offered to the model.
// The ignore list never applies to untyped (`unknown`) commits. Also the non-product path rule used by Uncovered.

import type { NoiseReason } from '../../../supabase/functions/_shared/core/units-wire.ts';
import { UNKNOWN_TYPE } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { IgnoreConfig, NonProductPaths } from '../config.ts';

export interface NoiseInput {
  subject: string;
  /** Conventional type or UNKNOWN_TYPE. */
  type: string;
  isMerge: boolean;
  /** PR number from any source (squash suffix or merge subject). */
  prNumber: number | null;
}

/** `WIP`, `[WIP]` or `wip:` at the start of a subject, as a whole word. */
const WIP = /^\[?wip\b/i;

export function noiseReason(commit: NoiseInput, ignore: IgnoreConfig): NoiseReason | null {
  const subject = commit.subject.trimStart();
  if (commit.isMerge && commit.prNumber === null) return 'merge_without_pr';
  if (subject.startsWith('fixup! ')) return 'fixup';
  if (subject.startsWith('squash! ')) return 'squash';
  if (subject.startsWith('amend! ')) return 'amend';
  if (WIP.test(subject)) return 'wip';
  if (isIgnoredType(commit.type, ignore)) return 'ignored_type';
  return null;
}

export function isIgnoredType(type: string, ignore: IgnoreConfig): boolean {
  return type !== UNKNOWN_TYPE && ignore.ignoredTypes.includes(type);
}

/** True for docs, tests, CI and lockfile paths (config/ignore.json `nonProductPaths`). */
export function isNonProductPath(path: string, rule: NonProductPaths): boolean {
  const p = path.replace(/\\/g, '/');
  if (rule.prefixes.some((prefix) => p.startsWith(prefix))) return true;
  if (rule.suffixes.some((suffix) => p.endsWith(suffix))) return true;
  const dirs = p.split('/').slice(0, -1);
  return dirs.some((segment) => rule.segments.includes(segment));
}

/** True when at least one path is a product path (an untyped unit touching one is Uncovered-eligible). */
export function touchesProductPath(paths: readonly string[], rule: NonProductPaths): boolean {
  return paths.some((path) => !isNonProductPath(path, rule));
}
