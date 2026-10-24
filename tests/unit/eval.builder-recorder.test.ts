import { describe, expect, it } from 'vitest';
import { screen, prepareCandidate } from '../../scripts/build-gold.ts';
import type { Candidate } from '../../scripts/build-gold.ts';
import { requireAuthorization } from '../../scripts/record-mock.ts';

const candidate: Candidate = { id: 'local-example', repository: 'synthetic/small-demo', public: true,
  from_ref: 'v3.1.0', to_ref: 'v3.2.0', gitlog: 'fixtures/gitlog/synthetic-small.gitlog.v1.json',
  license: 'MIT', license_url: 'https://example.test/LICENSE', retrieved_on: '2026-10-24', notes_url: 'https://example.test/releases/v3.2.0',
  notes_kind: 'handwritten', notes_reviewed: true, screening_reason: 'Handwritten entry provenance reviewed; synthetic test only.',
  entries: [{ id: 'init', text: 'Add an init command.', category: 'feature', pr_number: 201 }] };

describe('builder screening and live-recording gates', () => {
  it('excludes mechanical, unknown, private and non-permissive candidates with a reason', () => {
    expect(screen(candidate)).toBeNull();
    expect(screen({ ...candidate, notes_kind: 'mechanically-generated' })).toMatch(/provenance/);
    expect(screen({ ...candidate, notes_kind: 'unknown' })).toMatch(/provenance/);
    expect(screen({ ...candidate, license: 'NOASSERTION' })).toMatch(/license/);
    expect(screen({ ...candidate, public: false })).toMatch(/private/);
    expect(screen({ ...candidate, notes_kind: 'human-changeset', notes_reviewed: false })).toMatch(/review/);
    expect(screen({ ...candidate, notes_kind: 'human-changeset' })).toBeNull();
  });
  it('maps PR numbers through existing units, and refuses unmatched PR entries rather than silently dropping them', () => {
    const prepared = prepareCandidate(candidate);
    expect(prepared.entries[0]!.bullet.cites).toContain('832f6198f2d41ed88be0e6c1be92f42d860bc1a9');
    expect(() => prepareCandidate({ ...candidate, entries: [{ ...candidate.entries[0]!, pr_number: 999999 }] })).toThrow('no in-range PR');
  });
  it('requires both explicit authorization flag and env opt-in, as well as the key/model', () => {
    const env = { S29_RECORD_LIVE: '1', ANTHROPIC_API_KEY: 'synthetic-test-placeholder', GENERATOR_MODEL_ID: 'synthetic-test-model' };
    expect(() => requireAuthorization([], env)).toThrow('AND');
    expect(() => requireAuthorization(['--i-am-authorized'], { ...env, S29_RECORD_LIVE: undefined })).toThrow('AND');
    expect(() => requireAuthorization(['--i-am-authorized'], { ...env, ANTHROPIC_API_KEY: undefined })).toThrow('ANTHROPIC');
    expect(() => requireAuthorization(['--i-am-authorized'], env)).not.toThrow();
  });
});
