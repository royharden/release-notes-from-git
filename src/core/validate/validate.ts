// Deterministic validator, no model call. validateBullet runs every per-bullet check and lists each failing reason
// in REASON_CODES order (the first is the verdict's reason); validateAll adds the global duplicate_of check after
// all chunks are combined. Evidence carries what each check saw. Commit and bullet text are only ever compared,
// never interpreted: no check branches on what the text says it wants.

import { LIMITS, codePointLength } from '../../../supabase/functions/_shared/core/limits.ts';
import type { Thresholds } from '../config.ts';
import { DEFAULT_THRESHOLDS } from '../config.ts';
import { describeResolution } from '../cited/resolve.ts';
import type { FactIndex } from '../gitfacts/facts.ts';
import { normaliseText } from '../rulings/key.ts';
import { missingLiterals } from '../support/literals.ts';
import { supportScore, termJaccard } from '../support/score.ts';
import { categoryMismatch, collectEvidence, hasBreakingMarker, hasSecurityMarker } from './evidence.ts';
import { REASON_CODES, emptyEvidence } from './reasons.ts';
import type { BulletInput, ReasonCode, ValidateFn, Verdict, WarningCode } from './reasons.ts';

export interface ValidatorContext {
  facts: FactIndex;
  thresholds: Thresholds;
  /** Shas of units flagged possible_duplicate_unit (same subject and paths, no cherry-pick trailer). */
  possibleDuplicateShas: ReadonlySet<string>;
  /** When set, cites must also be in this request's input (model output before it joins the run). */
  requestShas?: ReadonlySet<string>;
}

export function validatorContext(
  facts: FactIndex,
  options: { thresholds?: Thresholds; possibleDuplicateShas?: ReadonlySet<string>; requestShas?: ReadonlySet<string> } = {},
): ValidatorContext {
  return {
    facts,
    thresholds: options.thresholds ?? DEFAULT_THRESHOLDS,
    possibleDuplicateShas: options.possibleDuplicateShas ?? new Set(),
    ...(options.requestShas === undefined ? {} : { requestShas: options.requestShas }),
  };
}

export function validateBullet(bullet: BulletInput, ctx: ValidatorContext): Verdict {
  const failing = new Set<ReasonCode>();
  const warnings: WarningCode[] = [];
  const evidence = emptyEvidence();

  if (bullet.cites.length === 0) {
    failing.add('no_citation');
    evidence.notes.push('the bullet cites no commit');
  }
  const collected = collectEvidence(bullet.cites, {
    facts: ctx.facts,
    ...(ctx.requestShas === undefined ? {} : { requestShas: ctx.requestShas }),
  });
  evidence.cites = collected.resolutions;
  evidence.activeShas = collected.activeShas;
  evidence.cancelledShas = collected.cancelledShas;
  for (const r of collected.resolutions) {
    if (r.status === 'not_found') failing.add('cite_not_found');
    else if (r.status === 'ambiguous') failing.add('cite_ambiguous');
    else if (r.status === 'out_of_range') failing.add('cite_out_of_range');
    if (r.status !== 'resolved' || !r.active) evidence.notes.push(describeResolution(r));
  }
  const resolvedCount = collected.activeShas.length + collected.cancelledShas.length;
  if (resolvedCount > 0 && collected.activeShas.length === 0) {
    failing.add('reverted_in_range');
    evidence.notes.push('every resolved cited commit is cancelled by a revert in range');
  }

  const length = codePointLength(bullet.text);
  if (length > LIMITS.maxBulletChars) {
    failing.add('too_long');
    evidence.notes.push(`${length} characters (max ${LIMITS.maxBulletChars})`);
  }

  let support: number | null = null;
  if (collected.activeShas.length > 0) {
    evidence.missingLiterals = missingLiterals(bullet.text, collected.text);
    if (evidence.missingLiterals.length > 0) {
      failing.add('literal_not_in_evidence');
      evidence.notes.push(`${evidence.missingLiterals.length} literal(s) not found verbatim in the cited commits`);
    }
    if (bullet.category === 'breaking' && !hasBreakingMarker(collected.activeShas, ctx.facts)) {
      failing.add('category_unsupported');
      evidence.notes.push('breaking needs "!" or a BREAKING CHANGE footer in a cited commit');
    }
    if (bullet.category === 'security' && !hasSecurityMarker(collected.text)) {
      failing.add('category_unsupported');
      evidence.notes.push('security needs a security word or a CVE id in a cited commit');
    }
    const scored = supportScore(bullet.text, collected.text);
    support = scored.score;
    evidence.matchedTerms = scored.matched;
    evidence.unmatchedTerms = scored.unmatched;
    if (scored.total === 0) {
      failing.add('low_support');
      evidence.notes.push('no content words to check against the cited commits');
    } else if (scored.score < ctx.thresholds.minSupport) {
      failing.add('low_support');
      evidence.notes.push(`support ${scored.matched.length}/${scored.total} below ${ctx.thresholds.minSupport}`);
    }
    if (categoryMismatch(bullet.category, collected.activeShas, ctx.facts)) warnings.push('category_mismatch');
    if (collected.activeShas.some((sha) => ctx.possibleDuplicateShas.has(sha))) warnings.push('possible_duplicate_unit');
  }

  return toVerdict(failing, warnings, evidence, support);
}

/** Per-bullet checks, then duplicate_of against earlier bullets that passed every per-bullet check. */
export function validateAll(bullets: readonly BulletInput[], ctx: ValidatorContext): Verdict[] {
  const verdicts = bullets.map((b) => validateBullet(b, ctx));
  const keptSoFar: { index: number; text: string; normalised: string; cites: string }[] = [];
  bullets.forEach((bullet, index) => {
    const verdict = verdicts[index] as Verdict;
    const normalised = normaliseText(bullet.text);
    const cites = [...verdict.evidence.activeShas].sort().join(',');
    const earlier = keptSoFar.find(
      (k) =>
        k.normalised === normalised ||
        (cites !== '' && k.cites === cites && termJaccard(k.text, bullet.text) >= ctx.thresholds.duplicateJaccard),
    );
    if (earlier !== undefined) {
      const failing = new Set(verdict.reasons);
      failing.add('duplicate_of');
      const evidence = { ...verdict.evidence, duplicateOf: bullets[earlier.index]?.key ?? `#${earlier.index}` };
      evidence.notes = [...evidence.notes, `duplicates bullet ${evidence.duplicateOf}`];
      verdicts[index] = toVerdict(failing, verdict.warnings, evidence, verdict.support_score);
      return;
    }
    if (verdict.kept) keptSoFar.push({ index, text: bullet.text, normalised, cites });
  });
  return verdicts;
}

/** validateAll with its context bound: the ValidateFn the export gate and review UI take. */
export function makeValidator(ctx: ValidatorContext): ValidateFn {
  return (bullets) => validateAll(bullets, ctx);
}

function toVerdict(failing: ReadonlySet<ReasonCode>, warnings: WarningCode[], evidence: Verdict['evidence'], support: number | null): Verdict {
  const reasons = REASON_CODES.filter((code) => failing.has(code));
  return { kept: reasons.length === 0, reason: reasons[0] ?? null, reasons, warnings, evidence, support_score: support };
}
