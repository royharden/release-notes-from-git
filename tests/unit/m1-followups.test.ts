import { describe, expect, it } from 'vitest';
import { escapeInline, toSingleLine } from '../../src/core/export/escape.ts';
import { prepareExport } from '../../src/core/export/gate.ts';
import { baseUrlProblem } from '../../src/core/gitlog/redact.ts';
import { initialReviewState } from '../../src/core/rulings/replay.ts';
import { makeValidator } from '../../src/core/validate/validate.ts';
import { pipeline } from '../helpers/fixtures.ts';

describe('M1 nonblocking follow-up regressions', () => {
  it('strips escaped invisible format characters and keeps package-string markup inert', () => {
    expect(toSingleLine('a\u200bb\u202ec\u2066d\ufeff')).toBe('abcd');
    expect(escapeInline('lodash@4.17.21')).toBe('`lodash@4.17.21`');
  });
  it('detects a percent-encoded address even in an unparseable base_url', () => {
    expect(baseUrlProblem('not-a-url/fixture%40example.test')).toBe('email');
  });
  it('refuses invalid calendar days but permits leap day, and counts only exported human adds', async () => {
    const p = pipeline('synthetic-traps');
    const validate = makeValidator(p.ctx);
    const cite = 'c760a2c93b16ef1380282788df0af218f6fdb0ae';
    const state = await initialReviewState([
      { text: 'Failed requests retry up to 3 times.', category: 'feature', cites: [cite] },
      { text: 'Various improvements.', category: 'other', cites: [cite] },
    ], validate);
    state.bullets.forEach((b) => { b.origin = 'human_add'; });
    const meta = { version: 'v1', date: '2024-02-29', base_url: null, input_sha256: '1'.repeat(64), config_version: '2'.repeat(64) };
    const prepared = prepareExport(state, meta, validate);
    if (!prepared.ok) throw new Error(prepared.code);
    expect(prepared.document.counts).toMatchObject({ generated: 0, human_added: 1 });
    expect(prepared.document.bullets).toHaveLength(1);
    for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-04-31']) {
      expect(prepareExport(state, { ...meta, date }, validate)).toMatchObject({ ok: false, code: 'bad_meta' });
    }
  });
});
