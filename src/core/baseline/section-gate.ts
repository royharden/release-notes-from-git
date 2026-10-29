// Section-gate comparator (eval Part B): a local, explicitly approximate landmark-style check on the same raw model
// output. It does not check bullets; it keeps or drops whole sections. A section is grounded when at least one
// cite of at least one of its bullets resolves to an in-range commit carrying the section's marker:
//   Breaking    -> a breaking marker (`!` or footer)
//   Features    -> a `feat` commit
//   Fixes       -> a `fix` commit, or (for security bullets) a security word or CVE id
//   Performance -> a `perf` commit
//   Other       -> any resolved commit
// Every bullet in a grounded section is kept, whatever it claims; every bullet in an ungrounded section drops.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import { resolveCites } from '../cited/resolve.ts';
import type { ResolveContext } from '../cited/resolve.ts';
import { sectionOf } from '../export/markdown.ts';
import type { SectionTitle } from '../export/markdown.ts';
import { commitEvidenceText } from '../gitfacts/facts.ts';
import type { CommitFact } from '../gitfacts/facts.ts';
import type { BulletInput } from '../validate/reasons.ts';
import { hasSecurityMarker } from '../validate/evidence.ts';

export interface SectionGateResult {
  kept: BulletInput[];
  dropped: BulletInput[];
  grounded: Record<SectionTitle, boolean>;
}

function marks(category: Category, fact: CommitFact): boolean {
  switch (sectionOf(category)) {
    case 'Breaking':
      return fact.breaking;
    case 'Features':
      return fact.type === 'feat';
    case 'Fixes':
      return category === 'security' ? hasSecurityMarker(commitEvidenceText(fact)) || fact.type === 'fix' : fact.type === 'fix';
    case 'Performance':
      return fact.type === 'perf';
    case 'Other':
      return true;
  }
}

export function sectionGate(bullets: readonly BulletInput[], ctx: ResolveContext): SectionGateResult {
  const grounded: Record<SectionTitle, boolean> = { Breaking: false, Features: false, Fixes: false, Performance: false, Other: false };
  for (const bullet of bullets) {
    for (const r of resolveCites(bullet.cites, ctx)) {
      if (r.status !== 'resolved') continue;
      const fact = ctx.facts.commits.get(r.sha);
      if (fact !== undefined && marks(bullet.category, fact)) grounded[sectionOf(bullet.category)] = true;
    }
  }
  const kept = bullets.filter((b) => grounded[sectionOf(b.category)]);
  const dropped = bullets.filter((b) => !grounded[sectionOf(b.category)]);
  return { kept: [...kept], dropped: [...dropped], grounded };
}
