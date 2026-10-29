import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from '../../src/data/memory-repo.ts';
import { makeReviewValidator, validatorForRulings } from '../../src/services/generation.ts';
import { applyRulings, initialReviewState } from '../../src/core/rulings/replay.ts';
import { configVersion, evidenceFingerprint } from '../../src/core/rulings/fingerprint.ts';
import { currentApprovalHash, exportApproved } from '../../src/core/export/gate.ts';
import { isLive } from '../../src/core/rulings/types.ts';
import type { Ruling } from '../../src/core/rulings/types.ts';
import type { RequestDrop } from '../../src/data/repo.ts';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import { fixtureText, pipeline } from '../helpers/fixtures.ts';

describe('request provenance after persistence and successive review actions', () => {
  it('a later category-only/no-op edit invalidates an older approval after complete-event reload',async () => {
    const p = pipeline('synthetic-traps'); const validate = makeReviewValidator(p.ctx,[]);
    const first = p.units.find((unit) => unit.noise_reason === null && unit.revert_state === 'active')!;
    const initial = await initialReviewState([{ text: first.subjects[0]!,category: 'other',cites: [first.shas[0]!] }],validate);
    const bullet = initial.bullets[0]!; const version = await configVersion();
    const base = { fingerprint: await evidenceFingerprint(bullet.cites,{ facts: p.facts }),config_version: version,reason: null,actor: 'local-demo' };
    const events: Ruling[] = [
      { ...base,id: 'approval',action: 'approve',target_key: 'approved',approval_hash: 'approved',payload: { version: 'v1.0.0',date: '2026-10-24',base_url: null },created_at: '2026-10-24T00:00:00.000Z' },
      { ...base,id: 'edit',action: 'edit',target_key: bullet.key,approval_hash: null,payload: { text: bullet.text,category: bullet.category,cites: bullet.cites },created_at: '2026-10-24T00:00:00.001Z' },
    ];
    const replay = await applyRulings(initial,events,{ validate,fingerprint: (cites) => evidenceFingerprint(cites,{ facts: p.facts }),configVersion: version });
    expect(replay.latestApproval).toBeNull();
    expect(replay.bullets.filter(isLive)).toHaveLength(1);
    const renewed: Ruling = { ...base,id: 'renewed',action: 'approve',target_key: 'new-hash',approval_hash: 'new-hash',payload: { version: 'v1.0.0',date: '2026-10-24',base_url: null },created_at: '2026-10-24T00:00:00.002Z' };
    const reapproved = await applyRulings(initial,[...events,renewed],{ validate,fingerprint: (cites) => evidenceFingerprint(cites,{ facts: p.facts }),configVersion: version });
    expect(reapproved.latestApproval).toEqual({ ruling_id: 'renewed',approval_hash: 'new-hash' });
  });
  it('category-only then multiple text edits cannot shed a request restriction at replay, approval or export',async () => {
    const p = pipeline('synthetic-traps');
    const other = p.units.find((unit) => unit.chunk_index === 1 && unit.noise_reason === null && unit.revert_state === 'active')!;
    const sha = other.shas.find((id) => p.facts.commits.get(id)?.active)!;
    const drop: RequestDrop = { index: 0,chunk_index: 0,bullet: { text: p.facts.commits.get(sha)!.subject,category: 'other',cites: [sha] },reason: 'cite_out_of_range',evidence: 'not in request input',outside: [sha],requestShas: p.units.filter((unit) => unit.chunk_index === 0 && unit.noise_reason === null).flatMap((unit) => unit.shas) };
    const version = await configVersion(); const repo = new MemoryRunRepository();
    const run = await repo.createRun({ repo_label: p.log.repo_label,from_ref: p.log.from_ref,to_ref: p.log.to_ref,input_sha256: '1'.repeat(64),config_version: version,parse_report: parseLog(fixtureText('synthetic-traps')).report,has_unit_omissions: false });
    await repo.insertUnits(run.id,p.units); await repo.acknowledgeOmissions(run.id); await repo.sealRun(run.id);
    const initial = await initialReviewState([drop.bullet],makeReviewValidator(p.ctx,[drop]));
    await repo.saveBullets(run.id,initial,[drop],[]);
    const loaded = await repo.getRun(run.id); let current = loaded.initial_review!;
    let validate = makeReviewValidator(p.ctx,loaded.request_drops);
    for (const [index,text] of [drop.bullet.text,`${drop.bullet.text} revised`,`${drop.bullet.text} revised again`].entries()) {
      const target = current.bullets.find(isLive)!;
      const event: Ruling = { id: crypto.randomUUID(),action: 'edit',target_key: target.key,payload: { text,category: 'fix',cites: target.cites },fingerprint: await evidenceFingerprint(target.cites,{ facts: p.facts }),config_version: version,approval_hash: null,reason: null,actor: 'local-demo',created_at: `2026-10-24T00:00:00.00${index}Z` };
      await repo.appendRuling(run.id,event);
      const events = await repo.listRulings(run.id);
      validate = await validatorForRulings(p.ctx,loaded.request_drops,loaded.initial_review!,events);
      current = await applyRulings(loaded.initial_review!,events,{ validate,fingerprint: (cites) => evidenceFingerprint(cites,{ facts: p.facts }),configVersion: version });
      expect(current.bullets.find(isLive)?.verdict.reason).toBe('cite_out_of_range');
    }
    const meta = { version: 'v1.0.0',date: '2026-10-24',base_url: null,input_sha256: run.input_sha256,config_version: version };
    // Even a forged stored kept cache is refused by the validator at the effect boundary.
    const target = current.bullets.find(isLive)!;
    target.verdict = { ...target.verdict,kept: true,reason: null,reasons: [] };
    const checked = await currentApprovalHash(current,meta,validate);
    expect(checked.ok).toBe(false);
    const exported = await exportApproved({ ...current,latestApproval: { ruling_id: 'fake',approval_hash: 'f'.repeat(64) } },meta,validate);
    expect(exported.ok).toBe(false);
    expect(loaded.request_drops).toEqual([drop]);
  });
});
