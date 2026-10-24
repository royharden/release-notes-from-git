import { describe, expect, it } from 'vitest';
import { auditCounts, fraction, micro, recall } from '../../scripts/eval.ts';
import type { GenuineEntry } from '../../scripts/mutate.ts';
import { pipeline } from '../helpers/fixtures.ts';

describe('evaluation denominators (source only until activation)', () => {
  it('micro-aggregates successes and trials rather than averaging release percentages', () => {
    // what_bug_this_catches: a one-entry release must not weigh as much as a nine-entry release.
    expect(micro([fraction(1, 1), fraction(0, 9)])).toEqual({ numerator: 1, denominator: 10, value: 0.1 });
  });
  it('never reports zero-denominator metrics as a pass or a zero-percent measurement', () => {
    expect(fraction(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(micro([]).value).toBeNull();
    expect(() => fraction(2, 1)).toThrow();
    expect(() => fraction(0, -1)).toThrow();
  });
  it('counts each mapped human entry once, with prefix resolution and OR across its commits', () => {
    const p = pipeline('synthetic-small');
    const a = 'e512dc87498617a63d9760c86d15d65ce9fb5f6d';
    const b = 'bbacaac263e0012d96e8ef8795cab5fefd241765';
    const entry = (id: string, cites: string[]): GenuineEntry => ({ id, pr_number: null, bullet: { text: 'Entry', category: 'other', cites } });
    const entries = [entry('one', [a, b]), entry('two', ['832f6198f2d41ed88be0e6c1be92f42d860bc1a9'])];
    const bullets = [entry('a', [a.slice(0, 12)]).bullet, entry('b', [b]).bullet, entry('again', [a]).bullet];
    expect(recall(entries, bullets, p.facts)).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(recall(entries, [], p.facts).value).toBe(0);
  });
  it('keeps partial audit labels separate and uses unsupported-only drop denominator', () => {
    const result = auditCounts([
      { id: 'a', label: 'supported', kept: true }, { id: 'b', label: 'partial', kept: true },
      { id: 'c', label: 'unsupported', kept: false }, { id: 'd', label: 'unsupported', kept: true },
    ]);
    expect(result.precision).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(result.unsupportedDrop).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.partial).toBe(1);
    expect(auditCounts([]).precision.value).toBeNull();
  });
});
