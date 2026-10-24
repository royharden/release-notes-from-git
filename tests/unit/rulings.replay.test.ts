import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../../src/core/config.ts';
import { configVersion, evidenceFingerprint } from '../../src/core/rulings/fingerprint.ts';
import { normaliseText, rulingKey } from '../../src/core/rulings/key.ts';
import { applyRulings, canRestore, initialReviewState } from '../../src/core/rulings/replay.ts';
import type { ReplayContext } from '../../src/core/rulings/replay.ts';
import type { Ruling, ReviewState } from '../../src/core/rulings/types.ts';
import { makeValidator } from '../../src/core/validate/validate.ts';
import { pipeline, pipelineFromLog, traps } from '../helpers/fixtures.ts';

const p = pipeline('synthetic-traps');
const validate = makeValidator(p.ctx);
const cite = 'c760a2c93b16ef1380282788df0af218f6fdb0ae';
const valid = { text: 'Failed requests are retried up to 3 times with exponential backoff.', category: 'feature' as const, cites: [cite] };

async function context(): Promise<ReplayContext> {
  return { validate, fingerprint: (cites) => evidenceFingerprint(cites, p.ctx), configVersion: await configVersion() };
}
async function remove(state: ReviewState): Promise<Ruling> {
  const bullet = state.bullets[0]!;
  return { id: 'event-1', target_key: bullet.key, fingerprint: await evidenceFingerprint(bullet.cites, p.ctx),
    config_version: await configVersion(), approval_hash: null, reason: null, actor: 'local-demo',
    created_at: '2026-10-24T12:00:00Z', action: 'remove', payload: {} };
}

describe('ruling key/fingerprint/config replay identity', () => {
  it('replays only matching identity and applies a repeated event id once', async () => {
    const state = await initialReviewState([valid], validate);
    const event = await remove(state);
    const next = await applyRulings(state, [event, event], await context());
    expect(next.bullets[0]?.removed).toBe(true);
    expect(next.notReplayed).toEqual([]);
    expect(state.bullets[0]?.removed).toBe(false);
  });
  it.each(['key', 'fingerprint', 'config'] as const)('orphans a %s mismatch visibly', async (field) => {
    const state = await initialReviewState([valid], validate);
    const event = await remove(state);
    const changed: Ruling = { ...event, ...(field === 'key' ? { target_key: 'no-such-key' } : field === 'fingerprint' ? { fingerprint: '0'.repeat(64) } : { config_version: '0'.repeat(64) }) };
    const next = await applyRulings(state, [changed], await context());
    expect(next.bullets[0]?.removed).toBe(false);
    expect(next.notReplayed).toEqual([changed]);
  });
  it('a changed commit changes fingerprint and changed thresholds change config version', async () => {
    const changed = pipelineFromLog({ ...p.log, commits: p.log.commits.map((c) => c.sha === cite ? { ...c, body: `${c.body}\nChanged evidence.` } : c) });
    expect(await evidenceFingerprint([cite], changed.ctx)).not.toBe(await evidenceFingerprint([cite], p.ctx));
    expect(await configVersion({ ...DEFAULT_THRESHOLDS, minSupport: 0.75 })).not.toBe(await configVersion());
  });
  it('resolves prefixes to full cites for content keys and emits NFC after lowercasing', async () => {
    const short = await initialReviewState([{ ...valid, cites: [cite.slice(0, 7).toUpperCase()] }], validate);
    const full = await initialReviewState([valid], validate);
    expect(short.bullets[0]?.key).toBe(full.bullets[0]?.key);
    const normalized = normaliseText('\u1e9b\u0323  CAFÉ');
    expect(normalized).toBe(normalized.normalize('NFC'));
    expect(await rulingKey('CAFÉ', [cite])).toBe(await rulingKey('cafe\u0301', [cite]));
  });
});

describe('restore and edit review contracts', () => {
  it('restores a soft drop only with a reason, marks attestation and refuses a hard drop', async () => {
    const soft = { ...valid, text: 'Various improvements.' };
    const state = await initialReviewState([soft, { ...valid, cites: [traps().phantom_sha] }], validate);
    const base = await remove(state);
    const restore: Ruling = { ...base, action: 'restore', reason: 'Reviewed commit manually', payload: {} };
    expect(canRestore(state.bullets[0]!.verdict)).toEqual({ ok: true });
    expect(canRestore(state.bullets[1]!.verdict)).toMatchObject({ ok: false, why: 'hard_reason', label: 'Repair citations first' });
    const restored = await applyRulings(state, [restore], await context());
    expect(restored.bullets[0]).toMatchObject({ attestation: 'human_attested', restore_reason: restore.reason });
    expect(restored.bullets[0]?.verdict.kept).toBe(false);
    const refused = await applyRulings(state, [{ ...restore, reason: ' ' }], await context());
    expect(refused.notReplayed).toHaveLength(1);
  });
  it('applies a category-only edit although category is absent from the content key', async () => {
    const state = await initialReviewState([valid], validate);
    const base = await remove(state);
    const event: Ruling = { ...base, action: 'edit', payload: { ...valid, category: 'breaking' } };
    const next = await applyRulings(state, [event], await context());
    expect(next.bullets).toHaveLength(1);
    expect(next.bullets[0]).toMatchObject({ key: state.bullets[0]?.key, category: 'breaking', superseded_by: null, verdict: { reason: 'category_unsupported' } });
  });
  it('replays append-only text edits against the previous key and revalidates the replacement', async () => {
    const state = await initialReviewState([valid], validate);
    const event: Ruling = { ...await remove(state), action: 'edit', payload: { ...valid, text: 'Failed requests retry up to 5 times.' } };
    const next = await applyRulings(state, [event], await context());
    expect(next.bullets).toHaveLength(2);
    expect(next.bullets[0]?.superseded_by).toBe(next.bullets[1]?.key);
    expect(next.bullets[1]).toMatchObject({ origin: 'human_edit', verdict: { reason: 'literal_not_in_evidence' } });
  });
});
