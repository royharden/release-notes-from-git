import { describe, expect, it } from 'vitest';
import { literalText, ruleBasedBullets } from '../../src/core/baseline/rule-based.ts';
import { sectionGate } from '../../src/core/baseline/section-gate.ts';
import { uncoveredUnits } from '../../src/core/gitfacts/units.ts';
import { validateBullet } from '../../src/core/validate/validate.ts';
import { pipeline } from '../helpers/fixtures.ts';

describe('baselines and uncovered units', () => {
  it('literal-add preserves leading version/URL case and removes only prefix and PR suffix', () => {
    expect(literalText({ subjects: ['fix: v1.2.3 parsing (#17)'], body: '' })).toBe('v1.2.3 parsing');
    expect(literalText({ subjects: ['fix: https://example.test/Case'], body: '' })).toBe('https://example.test/Case');
  });
  it('rule-based output skips noise and cancelled units and cites only active supplied commits', () => {
    const p = pipeline('synthetic-traps');
    const bullets = ruleBasedBullets(p.units, p.facts);
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) expect(bullet.cites.every((sha) => p.facts.commits.get(sha)?.active)).toBe(true);
    const cancelled = '43a66549a5006b14ec35b0bb82f8106ea7b302ee';
    expect(bullets.some((b) => b.cites.includes(cancelled))).toBe(false);
  });
  it('uncovered separates typed/untyped product units and removes units cited by kept bullets', () => {
    const p = pipeline('synthetic-untyped');
    const before = uncoveredUnits(p.units, new Set());
    expect(before.untyped.length).toBeGreaterThan(0);
    const covered = before.untyped[0]!;
    expect(uncoveredUnits(p.units, new Set(covered.shas)).untyped.some((u) => u.unit_key === covered.unit_key)).toBe(false);
  });
  it('section-gate comparator keeps an unsupported bullet if another bullet grounds its section', () => {
    const p = pipeline('synthetic-traps');
    const good = { text: 'Failed requests retry up to 3 times.', category: 'feature' as const, cites: ['c760a2c93b16ef1380282788df0af218f6fdb0ae'] };
    const bad = { ...good, text: 'Quantum zebras fly.', cites: ['f'.repeat(40)] };
    expect(sectionGate([good, bad], p.ctx).kept).toEqual([good, bad]);
    expect(validateBullet(bad, p.ctx).reason).toBe('cite_not_found');
  });
});
