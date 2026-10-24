import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from '../../src/data/memory-repo.ts';
import { generateDemo, makeReviewValidator, validatorForRulings, DemoGenerationError } from '../../src/services/generation.ts';
import { initialReviewState, applyRulings, contentKey, canRestore } from '../../src/core/rulings/replay.ts';
import { configVersion, evidenceFingerprint } from '../../src/core/rulings/fingerprint.ts';
import { currentApprovalHash, exportApproved } from '../../src/core/export/gate.ts';
import type { Ruling } from '../../src/core/rulings/types.ts';
import type { RequestDrop } from '../../src/data/repo.ts';
import { validateBullet } from '../../src/core/validate/validate.ts';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import { fixtureText, pipeline } from '../helpers/fixtures.ts';

const p = pipeline('synthetic-traps');
async function draft() {
  const repo = new MemoryRunRepository();
  const parse = parseLog(fixtureText('synthetic-traps'));
  const run = await repo.createRun({ repo_label: p.log.repo_label, from_ref: p.log.from_ref, to_ref: p.log.to_ref, input_sha256: '1'.repeat(64), config_version: await configVersion(), parse_report: parse.report, has_unit_omissions: false });
  await repo.insertUnits(run.id, p.units);
  return { repo, run };
}
describe('in-memory repository boundary', () => {
  it('requires omission acknowledgement, freezes sealed units, and returns isolated copies', async () => {
    const { repo, run } = await draft();
    await expect(repo.sealRun(run.id)).rejects.toThrow(/Acknowledge/);
    await repo.acknowledgeOmissions(run.id);
    const sealed = await repo.sealRun(run.id);
    expect(sealed.chunk_count).toBe(p.chunkCount);
    expect(sealed.revision_sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(repo.insertUnits(run.id, [])).rejects.toThrow(/immutable/);
    sealed.units.length = 0;
    expect((await repo.getRun(run.id)).units.length).toBe(p.units.length);
  });
  it('appends a client UUID once and refuses reuse with different content', async () => {
    const { repo, run } = await draft();
    await repo.acknowledgeOmissions(run.id); await repo.sealRun(run.id);
    const event: Ruling = { id: crypto.randomUUID(), action: 'remove', target_key: 'key', fingerprint: 'f'.repeat(64), config_version: run.config_version, approval_hash: null, reason: null, actor: 'local-demo', created_at: '2026-10-24T00:00:00.000Z', payload: {} };
    await repo.appendRuling(run.id, event); await repo.appendRuling(run.id, event);
    expect(await repo.listRulings(run.id)).toHaveLength(1);
    await expect(repo.appendRuling(run.id, { ...event, target_key: 'other' })).rejects.toThrow(/already used/);
  });
});

describe('exact recorded demo generation', () => {
  it('retains request-level drops and zero-cost ledger provenance through review and export', async () => {
    const generated = await generateDemo(p.units, 'synthetic-traps');
    expect(generated.requestDrops.length).toBeGreaterThan(0);
    expect(generated.ledger).toHaveLength(p.chunkCount);
    expect(generated.ledger.every((row) => row.actual_usd === 0 && row.provider === 'mock')).toBe(true);
    const validate = makeReviewValidator(p.ctx, generated.requestDrops);
    const initial = await initialReviewState(generated.bullets, validate);
    const requestBullets = generated.requestDrops.map((drop) => initial.bullets.find((bullet) => bullet.text === drop.bullet.text)!);
    requestBullets.forEach((bullet) => { expect(bullet.verdict.reason).toBe('cite_out_of_range'); expect(canRestore(bullet.verdict).ok).toBe(false); });
    const meta = { version: 'v1.0.0', date: '2026-10-24', base_url: null, input_sha256: '1'.repeat(64), config_version: await configVersion() };
    const hash = await currentApprovalHash(initial, meta, validate);
    if (!hash.ok) throw new Error(hash.detail);
    const approved = { ...initial, latestApproval: { ruling_id: 'approved', approval_hash: hash.hash } };
    const files = await exportApproved(approved, meta, validate);
    if (!files.ok) throw new Error(files.detail);
    const dropped = JSON.parse(files.droppedJson) as { dropped: { text: string; reason: string; evidence: { notes: string[] } }[] };
    for (const requestDrop of generated.requestDrops) expect(dropped.dropped.find((entry) => entry.text === requestDrop.bullet.text)).toMatchObject({ reason: 'cite_out_of_range', evidence: { notes: expect.arrayContaining(['not in request input']) } });
  });
  it('a changed input is an explicit replay miss, never a position-based success', async () => {
    const changed = p.units.map((unit, index) => index === 0 ? { ...unit, subjects: ['feat: altered evidence'] } : unit);
    await expect(generateDemo(changed, 'synthetic-traps')).rejects.toBeInstanceOf(DemoGenerationError);
    await expect(generateDemo(changed, null)).rejects.toThrow(/No exact recording/);
  });
  it('text-only edits inherit the request boundary; an explicit citation repair can pass', async () => {
    const first = p.units.find((unit) => unit.chunk_index === 0 && unit.noise_reason === null)!;
    const other = p.units.find((unit) => unit.chunk_index === 1 && unit.noise_reason === null && unit.revert_state !== 'cancelled')!;
    const sha = other.shas.find((id) => p.facts.commits.get(id)?.active)!;
    const requestShas = p.units.filter((unit) => unit.chunk_index === 0 && unit.noise_reason === null).flatMap((unit) => unit.shas);
    const drop: RequestDrop = { index: 0, chunk_index: 0, bullet: { text: p.facts.commits.get(sha)!.subject, category: 'other', cites: [sha] }, reason: 'cite_out_of_range', evidence: 'not in request input', outside: [sha], requestShas };
    const version = await configVersion();
    const initial = await initialReviewState([drop.bullet], makeReviewValidator(p.ctx, [drop]));
    const target = initial.bullets[0]!;
    const changed = { ...drop.bullet, text: `${drop.bullet.text} revised` };
    const edit: Ruling = { id: crypto.randomUUID(), action: 'edit', target_key: target.key, fingerprint: await evidenceFingerprint(target.cites, { facts: p.facts }), config_version: version, approval_hash: null, reason: null, actor: 'local-demo', created_at: '2026-10-24T00:00:00.001Z', payload: changed };
    const validate = await validatorForRulings(p.ctx, [drop], initial, [edit]);
    const replay = await applyRulings(initial, [edit], { validate, fingerprint: (cites) => evidenceFingerprint(cites, { facts: p.facts }), configVersion: version });
    const edited = replay.bullets.find((bullet) => bullet.superseded_by === null)!;
    expect(edited.verdict.reason).toBe('cite_out_of_range');
    expect(validate([changed])[0]?.reason).toBe('cite_out_of_range');
    const repairSha = first.shas.find((id) => p.facts.commits.get(id)?.active)!;
    const repaired = { text: p.facts.commits.get(repairSha)!.subject, category: 'other' as const, cites: [repairSha] };
    const repairedEvent: Ruling = { ...edit, id: crypto.randomUUID(), created_at: '2026-10-24T00:00:00.002Z', target_key: await contentKey(changed, validate([changed])[0]!), fingerprint: await evidenceFingerprint(changed.cites, { facts: p.facts }), payload: repaired };
    const repairedValidator = await validatorForRulings(p.ctx, [drop], initial, [edit, repairedEvent]);
    expect(repairedValidator([repaired])[0]).toEqual(validateBullet(repaired, p.ctx));
  });
});
