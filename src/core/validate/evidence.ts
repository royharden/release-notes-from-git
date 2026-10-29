// Evidence assembly for the validator: resolve cites, split resolved commits into active and cancelled, and build
// the text the content checks read (active cited subject/body/paths only). Also the category markers and the
// tie-break category used by the rule-based baseline and literal-add bullets.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import { UNKNOWN_TYPE } from '../../../supabase/functions/_shared/core/units-wire.ts';
import { resolveCites } from '../cited/resolve.ts';
import type { ResolveContext } from '../cited/resolve.ts';
import { commitEvidenceText } from '../gitfacts/facts.ts';
import type { CommitFact, FactIndex } from '../gitfacts/facts.ts';
import type { CiteResolution } from './reasons.ts';

export interface CollectedEvidence {
  resolutions: CiteResolution[];
  /** Resolved active shas, deduplicated, in cite order. */
  activeShas: string[];
  cancelledShas: string[];
  /** Subject/body/paths of the active cited commits, one block per commit. */
  text: string;
}

export function collectEvidence(cites: readonly string[], ctx: ResolveContext): CollectedEvidence {
  const resolutions = resolveCites(cites, ctx);
  const activeShas: string[] = [];
  const cancelledShas: string[] = [];
  for (const r of resolutions) {
    if (r.status !== 'resolved') continue;
    const list = r.active ? activeShas : cancelledShas;
    if (!list.includes(r.sha)) list.push(r.sha);
  }
  const text = activeShas
    .map((sha) => commitEvidenceText(ctx.facts.commits.get(sha) as CommitFact))
    .join('\n\n');
  return { resolutions, activeShas, cancelledShas, text };
}

/**
 * Security vocabulary: a `security` bullet needs one of these words, or a CVE id, in its active evidence.
 * Fixed list, matched as whole words, case-insensitive.
 */
export const SECURITY_WORDS = [
  'security',
  'vulnerability',
  'vulnerabilities',
  'vulnerable',
  'exploit',
  'exploitable',
  'xss',
  'csrf',
  'ssrf',
  'rce',
  'injection',
  'cve',
  'advisory',
] as const;

const SECURITY_RE = new RegExp(`\\b(?:${SECURITY_WORDS.join('|')})\\b`, 'i');
const CVE_RE = /\bCVE-\d{4}-\d{4,}\b/i;

export function hasSecurityMarker(text: string): boolean {
  return SECURITY_RE.test(text) || CVE_RE.test(text);
}

/** A breaking marker (`!` or footer) on at least one of the commits. */
export function hasBreakingMarker(shas: readonly string[], facts: Pick<FactIndex, 'commits'>): boolean {
  return shas.some((sha) => facts.commits.get(sha)?.breaking === true);
}

/** The bullet category a conventional type supports; null for types that support none in particular. */
export function categoryForType(type: string): Category | null {
  switch (type) {
    case 'feat':
      return 'feature';
    case 'fix':
      return 'fix';
    case 'perf':
      return 'performance';
    default:
      return null;
  }
}

/**
 * category_mismatch: only for feature/fix/performance bullets, and only when every typed active cited commit
 * contradicts the category (one matching typed commit, or no typed commit at all, means no warning). Merge
 * envelopes and untyped commits do not count.
 */
export function categoryMismatch(category: Category, activeShas: readonly string[], facts: Pick<FactIndex, 'commits'>): boolean {
  if (category !== 'feature' && category !== 'fix' && category !== 'performance') return false;
  const typed = activeShas
    .map((sha) => facts.commits.get(sha))
    .filter((f): f is CommitFact => f !== undefined && f.typed && !f.isMerge);
  if (typed.length === 0) return false;
  return typed.every((f) => categoryForType(f.type) !== category);
}

/**
 * Category for code-generated bullets (rule-based baseline, literal-add), tie-break order breaking, security,
 * feature, fix, performance, other. A model's category is never replaced by this; it is checked instead.
 */
export function deriveCategory(unit: { type: string; breaking: boolean; subjects: readonly string[]; body: string }): Category {
  if (unit.breaking) return 'breaking';
  if (hasSecurityMarker([...unit.subjects, unit.body].join('\n'))) return 'security';
  if (unit.type === UNKNOWN_TYPE) return 'other';
  return categoryForType(unit.type) ?? 'other';
}
