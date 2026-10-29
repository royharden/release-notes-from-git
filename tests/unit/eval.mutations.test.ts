import { describe, expect, it } from 'vitest';
import { OPERATORS, mutate, seededRandom } from '../../scripts/mutate.ts';
import type { GenuineEntry } from '../../scripts/mutate.ts';
import { validateBullet } from '../../src/core/validate/validate.ts';
import { hasBreakingMarker } from '../../src/core/validate/evidence.ts';
import { pipeline } from '../helpers/fixtures.ts';

const source: GenuineEntry = { id: 'retry', pr_number: null, bullet: { text: 'Retry failed requests up to 3 times.', category: 'feature', cites: ['c760a2c93b16ef1380282788df0af218f6fdb0ae'] } };
const donor: GenuineEntry = { id: 'tab-input', pr_number: 101, bullet: { text: 'Support tab-separated input.', category: 'feature', cites: ['d1d83a2235653280d16df3689d776fec18de20d0'] } };
function setup() {
  const p = pipeline('synthetic-traps');
  const map = new Map(p.units.flatMap((u) => u.shas.map((sha) => [sha, u.unit_key] as const)));
  return { ...p, map };
}
describe('seeded mutations and recorded preconditions', () => {
  it('replays exactly for every operator without changing its genuine source', () => {
    const p = setup(); const snapshot = JSON.stringify(source);
    for (const operator of OPERATORS) {
      const a = mutate(operator, source, [source, donor], p.facts, p.map, seededRandom(2901));
      const b = mutate(operator, source, [source, donor], p.facts, p.map, seededRandom(2901));
      expect(a).toEqual(b); expect(a.precondition.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(source)).toBe(snapshot);
  });
  it('constructs phantom/outside/literal/no-citation cases and measures their primary reason independently', () => {
    const p = setup();
    for (const operator of ['phantom_sha', 'outside_range_sha', 'invent_literal', 'no_citation'] as const) {
      const attempt = mutate(operator, source, [source, donor], p.facts, p.map, seededRandom(42));
      expect(attempt.eligible).toBe(true); expect(attempt.bullet).not.toBeNull();
      expect(validateBullet(attempt.bullet!, p.ctx).reason).toBe(attempt.expectedReason);
    }
  });
  it('applies the breaking100% target only to active cited evidence without a breaking marker', () => {
    const p = setup();
    const plain = mutate('inflate_breaking', source, [source], p.facts, p.map, seededRandom(1));
    expect(plain.eligible).toBe(true); expect(plain.target).toBe(1);
    expect(validateBullet(plain.bullet!, p.ctx).reason).toBe('category_unsupported');
    const breaking = [...p.facts.commits.values()].find((f) => f.breaking && f.active)!;
    expect(hasBreakingMarker([breaking.sha], p.facts)).toBe(true);
    const skipped = mutate('inflate_breaking', { ...source, bullet: { ...source.bullet, cites: [breaking.sha] } }, [source], p.facts, p.map, seededRandom(1));
    expect(skipped.eligible).toBe(false); expect(skipped.skip).toBe('active_cited_evidence_has_breaking_marker');
  });
  it('records missing outside/donor preconditions and keeps semantic operators report-only', () => {
    const p = setup();
    const facts = { ...p.facts, outside: new Set<string>(), boundaryParents: new Set<string>() };
    expect(mutate('outside_range_sha', source, [source], facts, p.map, seededRandom(2)).skip).toBe('no_known_outside_sha');
    expect(mutate('splice_claim', source, [source], facts, p.map, seededRandom(2)).skip).toBe('no_disjoint_donor_within_length');
    for (const operator of ['swap_cite', 'splice_claim'] as const) {
      const attempt = mutate(operator, source, [source, donor], facts, p.map, seededRandom(2));
      expect(attempt.target).toBeNull(); expect(attempt.expectedReason).toBeNull();
    }
  });
  it('does not count inactive/unresolved sources or an oversized mutated bullet as an eligible trial', () => {
    const p = setup();
    const missing = { ...source, bullet: { ...source.bullet, cites: ['f'.repeat(40)] } };
    expect(mutate('phantom_sha', missing, [missing], p.facts, p.map, seededRandom(1)).eligible).toBe(false);
    const long = { ...source, bullet: { ...source.bullet, text: 'a'.repeat(240) } };
    expect(mutate('invent_literal', long, [long], p.facts, p.map, seededRandom(1)).skip).toBe('mutation_too_long');
  });
});
