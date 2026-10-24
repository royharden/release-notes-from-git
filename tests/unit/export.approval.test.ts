import { describe, expect, it } from 'vitest';
import { buildApprovalPayload, computeApprovalHash } from '../../src/core/export/approval-hash.ts';
import type { ApprovalInput } from '../../src/core/export/approval-hash.ts';
import { currentApprovalHash, exportApproved, prepareExport } from '../../src/core/export/gate.ts';
import type { ExportMeta } from '../../src/core/export/json.ts';
import { rulingKey, rulingKeyInput } from '../../src/core/rulings/key.ts';
import type { ReviewBullet, ReviewState } from '../../src/core/rulings/types.ts';
import { emptyEvidence } from '../../src/core/validate/reasons.ts';
import type { ReasonCode, ValidateFn, Verdict } from '../../src/core/validate/reasons.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const META: ExportMeta = {
  version: '2.0.0',
  date: '2026-10-24',
  base_url: 'https://github.com/synthetic/demo',
  input_sha256: '1'.repeat(64),
  config_version: '2'.repeat(64),
};

function verdict(reason: ReasonCode | null, activeShas: string[]): Verdict {
  return {
    kept: reason === null,
    reason,
    reasons: reason === null ? [] : [reason],
    warnings: [],
    evidence: { ...emptyEvidence(), activeShas },
    support_score: reason === null ? 1 : 0.2,
  };
}

function rb(key: string, text: string, overrides: Partial<ReviewBullet> = {}): ReviewBullet {
  return {
    key,
    text,
    category: 'feature',
    cites: [A],
    origin: 'model',
    verdict: verdict(null, [A]),
    attestation: 'validator',
    restore_reason: null,
    removed: false,
    superseded_by: null,
    source_unit_key: null,
    ...overrides,
  };
}

function state(bullets: ReviewBullet[]): ReviewState {
  return { bullets, latestApproval: null, notReplayed: [] };
}

/** Validator fake: verdict by bullet text; otherwise kept with the bullet's cites as active evidence. */
function validator(byText: Record<string, Verdict> = {}): ValidateFn {
  return (bullets) => bullets.map((b) => byText[b.text] ?? verdict(null, b.cites));
}

async function approve(s: ReviewState, meta: ExportMeta, validate: ValidateFn): Promise<ReviewState> {
  const current = await currentApprovalHash(s, meta, validate);
  if (!current.ok) throw new Error(`cannot approve: ${current.code}`);
  return { ...s, latestApproval: { ruling_id: 'r-approve', approval_hash: current.hash } };
}

describe('approval hash', () => {
  const base: ApprovalInput = {
    exported: [{ key: 'k1', text: 'Added export', category: 'feature', cites: [A, B], attestation: 'validator', origin: 'model' }],
    removed: ['k9'],
    edits: [{ from: 'k2', to: 'k3' }],
    counts: { generated: 3, validator_kept: 2, validator_dropped: 1, human_removed: 1, human_restored: 0, human_added: 0 },
    meta: META,
  };
  const hashOf = (input: ApprovalInput): Promise<string> => computeApprovalHash(buildApprovalPayload(input));
  const withBullet = (patch: Partial<ApprovalInput['exported'][number]>): ApprovalInput => ({
    ...base,
    exported: [{ ...base.exported[0]!, ...patch }],
  });

  it('is independent of key insertion order and of cite order', async () => {
    const payload = buildApprovalPayload(base);
    const reordered = Object.fromEntries(Object.entries(payload).reverse()) as typeof payload;
    expect(await computeApprovalHash(reordered)).toBe(await computeApprovalHash(payload));
    expect(await hashOf(withBullet({ cites: [B, A] }))).toBe(await hashOf(base));
  });

  it('changes when any covered field changes', async () => {
    const variants: ApprovalInput[] = [
      withBullet({ text: 'Added exports' }),
      withBullet({ category: 'fix' }),
      withBullet({ cites: [A] }),
      withBullet({ attestation: 'human_attested' }),
      withBullet({ origin: 'human_edit' }),
      { ...base, removed: [] },
      { ...base, edits: [] },
      { ...base, counts: { ...base.counts, human_added: 1 } },
      { ...base, meta: { ...META, version: '2.0.1' } },
      { ...base, meta: { ...META, date: '2026-10-25' } },
      { ...base, meta: { ...META, base_url: null } },
      { ...base, meta: { ...META, input_sha256: '3'.repeat(64) } },
      { ...base, meta: { ...META, config_version: '4'.repeat(64) } },
      { ...base, exported: [] },
    ];
    const hashes = await Promise.all([base, ...variants].map(hashOf));
    expect(new Set(hashes).size).toBe(variants.length + 1);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('export gate', () => {
  const v = validator();

  it('refuses export without an approve ruling', async () => {
    const result = await exportApproved(state([rb('k1', 'Added export')]), META, v);
    expect(result).toMatchObject({ ok: false, code: 'not_approved' });
  });

  it('exports the three files when the approval hash matches', async () => {
    const approved = await approve(state([rb('k1', 'Added export')]), META, v);
    const result = await exportApproved(approved, META, v);
    if (!result.ok) throw new Error(result.code);
    expect(result.markdown).toContain(`- Added export [aaaaaaa](https://github.com/synthetic/demo/commit/${A})`);
    expect(JSON.parse(result.releaseNotesJson)).toMatchObject({ approval_hash: result.approvalHash, version: '2.0.0' });
    expect(JSON.parse(result.droppedJson)).toMatchObject({ dropped: [] });
  });

  const same = (s: ReviewState): ReviewState => s;
  const changes: [string, (s: ReviewState) => ReviewState, ExportMeta][] = [
    ['an edit', (s) => ({ ...s, bullets: s.bullets.map((b) => ({ ...b, text: 'Added exports' })) }), META],
    ['a removal', (s) => ({ ...s, bullets: s.bullets.map((b) => ({ ...b, removed: true })) }), META],
    ['a version change', same, { ...META, version: '2.0.1' }],
    ['a date change', same, { ...META, date: '2026-10-25' }],
    ['a base_url change', same, { ...META, base_url: null }],
  ];

  it.each(changes)('invalidates approval after %s', async (_label, change, meta) => {
    const approved = await approve(state([rb('k1', 'Added export'), rb('k2', 'Fixed crash', { category: 'fix' })]), META, v);
    const result = await exportApproved(change(approved), meta, v);
    expect(result).toMatchObject({ ok: false, code: 'approval_mismatch' });
  });

  it('refuses a stored-kept bullet that now fails a hard reason, even when approved', async () => {
    const s = state([rb('k1', 'Added export'), rb('k2', 'Phantom feature', { cites: ['f'.repeat(40)] })]);
    const approved = await approve(s, META, v);
    const strict = validator({ 'Phantom feature': verdict('cite_not_found', []) });
    const result = await exportApproved(approved, META, strict);
    expect(result).toMatchObject({ ok: false, code: 'hard_reason', keys: ['k2'] });
  });

  it('refuses a human-attested bullet with a hard reason', async () => {
    const s = state([
      rb('k1', 'Outside change', {
        verdict: verdict('cite_out_of_range', []),
        attestation: 'human_attested',
        restore_reason: 'trust me',
      }),
    ]);
    const result = prepareExport(s, META, validator({ 'Outside change': verdict('cite_out_of_range', []) }));
    expect(result).toMatchObject({ ok: false, code: 'hard_reason', keys: ['k1'] });
  });

  it('exports a restored soft drop marked human_attested and lists it in dropped.json', async () => {
    const lowSupport = verdict('low_support', [A]);
    const s = state([
      rb('k1', 'Added export'),
      rb('k2', 'Tidied the widget', { verdict: lowSupport, attestation: 'human_attested', restore_reason: 'checked by hand' }),
    ]);
    const v2 = validator({ 'Tidied the widget': lowSupport });
    const result = await exportApproved(await approve(s, META, v2), META, v2);
    if (!result.ok) throw new Error(result.code);
    expect(result.markdown).toContain('- Tidied the widget [aaaaaaa]');
    expect(result.markdown).toContain('(human_attested)');
    const notes = JSON.parse(result.releaseNotesJson) as { bullets: { text: string; attestation: string }[]; counts: { human_restored: number } };
    expect(notes.bullets.find((b) => b.text === 'Tidied the widget')?.attestation).toBe('human_attested');
    expect(notes.counts.human_restored).toBe(1);
    const dropped = JSON.parse(result.droppedJson) as { dropped: { key: string; reason: string; disposition: string }[] };
    expect(dropped.dropped).toEqual([expect.objectContaining({ key: 'k2', reason: 'low_support', disposition: 'restored' })]);
  });

  it('keeps hard-dropped, unattested bullets out of the notes without refusing', async () => {
    const phantom = verdict('cite_not_found', []);
    const s = state([rb('k1', 'Added export'), rb('k2', 'Phantom feature', { verdict: phantom, cites: ['f'.repeat(40)] })]);
    const v2 = validator({ 'Phantom feature': phantom });
    const result = await exportApproved(await approve(s, META, v2), META, v2);
    if (!result.ok) throw new Error(result.code);
    expect(result.markdown).not.toContain('Phantom feature');
    expect(JSON.parse(result.droppedJson)).toMatchObject({ dropped: [{ key: 'k2', reason: 'cite_not_found', disposition: 'dropped' }] });
  });

  it('refuses invalid export meta', () => {
    expect(prepareExport(state([]), { ...META, date: '2026-02-30' }, v)).toMatchObject({ ok: false, code: 'bad_meta' });
    expect(prepareExport(state([]), { ...META, version: '' }, v)).toMatchObject({ ok: false, code: 'bad_meta' });
    expect(prepareExport(state([]), { ...META, version: 'v1\n# injected' }, v)).toMatchObject({ ok: false, code: 'bad_meta' });
  });

  it('refuses a meta base_url that carries credentials or an email, and a version with an email', () => {
    const refusal = { ok: false, code: 'bad_meta' };
    const credentialed = { ...META, base_url: 'https://user:token@github.com/synthetic/demo' };
    expect(prepareExport(state([]), credentialed, v)).toMatchObject({ ...refusal, detail: 'base_url must not carry credentials' });
    const withEmail = { ...META, base_url: 'https://git.example.com/zelda.q@example-mail.org/repo' };
    expect(prepareExport(state([]), withEmail, v)).toMatchObject({ ...refusal, detail: 'base_url must not contain an email address' });
    const encoded = { ...META, base_url: 'https://git.example.com/x?owner=zelda.q%40example-mail.org' };
    expect(prepareExport(state([]), encoded, v)).toMatchObject({ ...refusal, detail: 'base_url must not contain an email address' });
    expect(prepareExport(state([]), { ...META, version: '2.0.0 zelda.q@example-mail.org' }, v)).toMatchObject(refusal);
  });
});

describe('ruling key', () => {
  it('normalises case, whitespace, NFC and cite order', async () => {
    const composed = 'Café  export';
    const decomposed = 'café EXPORT ';
    expect(rulingKeyInput(composed, [B, A])).toBe(rulingKeyInput(decomposed, [A.toUpperCase(), B]));
    expect(await rulingKey(composed, [B, A])).toBe(await rulingKey(decomposed, [A, B, A]));
    expect(await rulingKey(composed, [A])).not.toBe(await rulingKey(composed, [B]));
  });
});
