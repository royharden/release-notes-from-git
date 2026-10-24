import { describe, expect, it } from 'vitest';
import { buildFacts, topologicalOrder } from '../../src/core/gitfacts/facts.ts';
import { chunkUnits } from '../../src/core/gitfacts/chunk.ts';
import { groupUnits } from '../../src/core/gitfacts/units.ts';
import type { UnitDraft } from '../../src/core/gitfacts/units.ts';
import { pairReverts } from '../../src/core/gitfacts/revert.ts';
import { cherrySource } from '../../src/core/gitfacts/cherry.ts';
import { promptChars, excerptBody } from '../../supabase/functions/_shared/core/units-wire.ts';
import { pipeline } from '../helpers/fixtures.ts';

const sha = (n: number): string => n.toString(16).padStart(40, '0');
function unit(n: number, subjects = ['change']): UnitDraft {
  return { ordinal: n, unit_key: `u${n}`, shas: [sha(n + 1)], pr_number: null, type: 'unknown', scope: null,
    breaking: false, subjects, body: '', paths: [], noise_reason: null, revert_state: 'active' };
}

describe('unit and chunk bounds', () => {
  it('400-unit cap accepts 400 and rejects 401 units without truncating', () => {
    const log = pipeline('synthetic-small').log;
    const template = log.commits[0]!;
    const make = (count: number) => buildFacts({ ...log, rejected: [], outside_shas: [], commits: Array.from({ length: count }, (_, n) =>
      ({ ...template, sha: sha(n + 1), parents: n === 0 ? [] : [sha(n)], subject: `Standalone change ${n}`, body: '' })) });
    const accepted = groupUnits(make(400));
    expect(accepted.ok && accepted.units.length).toBe(400);
    expect(groupUnits(make(401))).toEqual({ ok: false, code: 'too_many_units', unitCount: 401, limit: 400 });
  });

  it('40-unit chunking: 40 stays in chunk 0, unit 41 starts chunk 1', () => {
    const result = chunkUnits(Array.from({ length: 41 }, (_, n) => unit(n)));
    if (!result.ok) throw new Error(result.code);
    expect(result.units.slice(0, 40).every((u) => u.chunk_index === 0)).toBe(true);
    expect(result.units[40]?.chunk_index).toBe(1);
    expect(result.chunkCount).toBe(2);
  });

  it('60,000-char chunking: exact boundary fits and one extra code point splits early', () => {
    const first = unit(0, ['x'.repeat(29_998)]); // 30,000 including the two text separators
    const second = unit(1, ['x'.repeat(29_998)]);
    const result = chunkUnits([first, second, unit(2, ['x'])]);
    if (!result.ok) throw new Error(result.code);
    expect(result.units.map((u) => u.chunk_index)).toEqual([0, 0, 1]);
    expect(result.units.slice(0, 2).reduce((n, u) => n + promptChars(u), 0)).toBe(60_000);
  });

  it('rejects a single unit above 60,000 chars visibly and renumbers retained units', () => {
    const result = chunkUnits([unit(0, ['x'.repeat(59_999)]), unit(1)]);
    if (!result.ok) throw new Error(result.code);
    expect(result.oversized).toEqual([{ unit_key: 'u0', prompt_chars: 60_001, limit: 60_000 }]);
    expect(result.units.map((u) => [u.unit_key, u.ordinal, u.chunk_index])).toEqual([['u1', 0, 0]]);
  });

  it('refuses more than 10 chunks, including early character splits', () => {
    expect(chunkUnits(Array.from({ length: 11 }, (_, n) => unit(n, ['x'.repeat(40_000)]))))
      .toMatchObject({ ok: false, code: 'too_many_chunks', chunkCount: 11, limit: 10 });
  });

  it('counts code points and excerpts 1,500 body code points without splitting a surrogate pair', () => {
    const draft = { ...unit(0, ['😀']), body: '😀'.repeat(1_501), paths: ['界'] };
    expect(promptChars(draft)).toBe(1_504);
    expect(excerptBody(draft.body)).toEqual({ text: '😀'.repeat(1_500), truncated: true });
    expect(draft.body).toBe('😀'.repeat(1_501));
  });
});

describe('graph and trailer boundaries', () => {
  it('reverts in parent order even when input and dates are reversed', () => {
    const log = pipeline('synthetic-small').log;
    const template = log.commits[0]!;
    const commits = [
      { ...template, sha: sha(3), parents: [sha(2)], subject: 'Revert "Revert original"', body: `This reverts commit ${sha(2)}.`, date: '2000-01-01T00:00:00Z' },
      { ...template, sha: sha(2), parents: [sha(1)], subject: 'Revert original', body: `This reverts commit ${sha(1)}.`, date: '2020-01-01T00:00:00Z' },
      { ...template, sha: sha(1), parents: [], subject: 'feat: original', body: '', date: '2099-01-01T00:00:00Z' },
    ];
    const facts = buildFacts({ ...log, commits });
    expect(facts.order).toEqual([sha(1), sha(2), sha(3)]);
    expect(facts.order.map((s) => facts.commits.get(s)?.revertState)).toEqual(['active', 'cancelled', 'cancelled']);
    expect(topologicalOrder([{ sha: sha(2), parents: [] }, { sha: sha(1), parents: [] }])).toEqual([sha(1), sha(2)]);
  });

  it('pairs unique >=7 sha prefixes and never guesses an ambiguous subject', () => {
    const a = 'abcdef1' + '0'.repeat(33);
    const r = 'fedcba2' + '0'.repeat(33);
    expect(pairReverts([{ sha: a, subject: 'original', body: '' }, { sha: r, subject: 'revert', body: 'This reverts commit abcdef1.' }]).states.get(a)).toBe('cancelled');
    const ambiguous = pairReverts([{ sha: sha(1), subject: 'same', body: '' }, { sha: sha(2), subject: 'same', body: '' }, { sha: sha(3), subject: 'Revert "same"', body: '' }]);
    expect(ambiguous.issues[0]).toMatchObject({ issue: 'target_ambiguous', candidates: [sha(1), sha(2)] });
  });

  it('does not collapse a cherry-pick mentioned in prose instead of an explicit trailer', () => {
    expect(cherrySource(`We discussed (cherry picked from commit ${sha(1)}) in prose.`)).toBeNull();
    expect(cherrySource(`Details.\n\n(cherry picked from commit ${sha(1)})`)).toBe(sha(1));
  });
});
