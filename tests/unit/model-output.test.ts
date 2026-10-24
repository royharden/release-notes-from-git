import { describe, expect, it } from 'vitest';
import { allowedShasFromUnits, parseModelOutput } from '../../supabase/functions/_shared/core/output-schema.ts';

const sha = (n: number): string => n.toString(16).padStart(40, '0');
const allowed = allowedShasFromUnits(Array.from({ length: 6 }, (_, n) => ({ unit_key: `u${n}`, shas: [sha(n + 1)] })));
const bullet = { text: 'Cache manifests', category: 'performance', cites: [sha(1)] };

describe('strict model output and request scope', () => {
  it.each(['version', 'date', 'heading', 'url', 'author', 'unexpected'])('refuses extra %s at top level and on bullets', (field) => {
    expect(parseModelOutput({ bullets: [bullet], [field]: 'invented' }, allowed)).toMatchObject({ ok: false, error: 'upstream_malformed' });
    expect(parseModelOutput({ bullets: [{ ...bullet, [field]: 'invented' }] }, allowed)).toMatchObject({ ok: false, error: 'upstream_malformed' });
  });
  it('refuses an excess bullet count as a whole-output fault, never silently trims it', () => {
    const onlyOne = new Map([[sha(1), 'u0']]);
    expect(parseModelOutput({ bullets: [bullet, bullet] }, onlyOne)).toMatchObject({ ok: false, detail: '2 bullets for 1 units' });
  });
  it('drops outside-request cites, rejects non-hex cites and enforces at most 5 distinct units', () => {
    const output = parseModelOutput({ bullets: [
      { ...bullet, cites: ['f'.repeat(40)] }, { ...bullet, cites: ['not-a-sha'] },
      { ...bullet, cites: Array.from(allowed.keys()) },
    ] }, allowed);
    if (!output.ok) throw new Error(output.detail);
    expect(output.bullets).toEqual([]);
    expect(output.outsideRequest).toEqual([expect.objectContaining({ index: 0, reason: 'cite_out_of_range', evidence: 'not in request input' })]);
    expect(output.violations.map((v) => v.code)).toEqual(['non_hex_cite', 'too_many_units']);
  });
  it('counts units rather than commits and leaves prefix collisions for the resolver', () => {
    const manyCommits = new Map(Array.from({ length: 6 }, (_, n) => [sha(n + 1), 'one-pr']));
    const result = parseModelOutput({ bullets: [{ ...bullet, cites: Array.from(manyCommits.keys()) }] }, manyCommits);
    expect(result).toMatchObject({ ok: true, bullets: [expect.anything()], violations: [] });
    expect(parseModelOutput({ bullets: [{ ...bullet, cites: ['0000000'] }] }, allowed)).toMatchObject({ ok: true, bullets: [expect.anything()], violations: [] });
  });
});
