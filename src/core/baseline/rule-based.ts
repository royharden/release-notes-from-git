// Rule-based changelog baseline (git-cliff style, no model): one bullet per unit that is neither noise nor
// cancelled, text = the unit's headline subject without its conventional prefix or `(#N)` suffix, category by the
// tie-break order (deriveCategory), cites = the unit's active commits. Supported by construction, so in eval it
// measures coverage and verbosity, not faithfulness. Also the source of literal-add bullets.

import type { WireUnit } from '../../../supabase/functions/_shared/core/units-wire.ts';
import { parseConventional } from '../gitfacts/conventional.ts';
import type { FactIndex } from '../gitfacts/facts.ts';
import { mergePrNumber, stripPrSuffix } from '../gitfacts/pr.ts';
import type { UnitDraft } from '../gitfacts/units.ts';
import type { BulletInput } from '../validate/reasons.ts';
import { deriveCategory } from '../validate/evidence.ts';

type BaselineUnit = Pick<WireUnit, 'unit_key' | 'shas' | 'type' | 'breaking' | 'subjects' | 'body' | 'noise_reason' | 'revert_state'>;

/** The subject a literal bullet starts from: a GitHub merge's PR title (first body line), else the first subject. */
export function unitHeadline(unit: Pick<UnitDraft, 'subjects' | 'body'>): string {
  const first = unit.subjects[0] ?? '';
  if (mergePrNumber(first) !== null && unit.subjects.length === 1) {
    const title = unit.body.split('\n').find((line) => line.trim() !== '');
    if (title !== undefined) return title.trim();
  }
  const nonMerge = unit.subjects.find((s) => mergePrNumber(s) === null);
  return nonMerge ?? first;
}

/** Headline without `type(scope)!: ` and `(#N)`; preserve case so leading literals stay verbatim. */
export function literalText(unit: Pick<UnitDraft, 'subjects' | 'body'>): string {
  const headline = stripPrSuffix(unitHeadline(unit));
  const description = parseConventional(headline, '').description || headline;
  return description;
}

/** A literal bullet for one unit (the "add uncovered unit" action); cites only the unit's active commits. */
export function literalBullet(unit: BaselineUnit, facts: Pick<FactIndex, 'commits'>): BulletInput {
  const cites = unit.shas.filter((sha) => facts.commits.get(sha)?.active === true);
  return { text: literalText(unit), category: deriveCategory(unit), cites };
}

export function ruleBasedBullets(units: readonly BaselineUnit[], facts: Pick<FactIndex, 'commits'>): BulletInput[] {
  return units
    .filter((u) => u.noise_reason === null && u.revert_state !== 'cancelled')
    .map((u) => literalBullet(u, facts))
    .filter((b) => b.cites.length > 0);
}
