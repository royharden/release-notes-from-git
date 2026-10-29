import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digest, insideRoot, main, makeAuditCase, makeRange, repositorySplits } from '../../scripts/eval.ts';
import type { AuditSample, DevFreeze, GoldManifest, RangeData } from '../../scripts/eval.ts';
import type { GenuineEntry } from '../../scripts/mutate.ts';
import { configVersion } from '../../src/core/rulings/fingerprint.ts';

// Entire CLI artifact I/O stays in memory: these tests never consume the product heldout marker.
const artifacts = vi.hoisted(() => ({ files: new Map<string, string>(), reads: [] as string[] }));
vi.mock('node:fs', () => ({
  existsSync: (path: string): boolean => artifacts.files.has(path),
  readFileSync: (path: string): string => {
    artifacts.reads.push(path);
    const text = artifacts.files.get(path);
    if (text === undefined) throw new Error(`missing test artifact: ${path}`);
    return text;
  },
  writeFileSync: (path: string, text: string, options?: { flag?: string }): void => {
    if (options?.flag === 'wx' && artifacts.files.has(path)) throw new Error('EEXIST');
    artifacts.files.set(path, text);
  },
}));

function put(path: string, data: unknown): string {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  artifacts.files.set(insideRoot(path), text);
  return text;
}
function get<T>(path: string): T {
  return JSON.parse(artifacts.files.get(insideRoot(path))!) as T;
}
interface TestRange { range: RangeData; gitlog: string; entries: string; id: string; repository: string }
function authoredRange(index: number): TestRange {
  const id = `range-${index}`; const repository = `synthetic/audit-${index}`; const sha = String(index + 1).repeat(40);
  const gitlog = JSON.stringify({ schema: 'gitlog.v1', repo_label: repository, from_ref: 'v1', to_ref: 'v2', outside_shas: [],
    commits: [{ sha, parents: [], date: '2026-10-24T10:00:00Z', subject: 'fix: prevent stale cache entries',
      body: 'Discard stale cache entries before returning a result.', files: [{ path: 'src/cache.ts', added: 2, deleted: 1 }] }] });
  const entries: GenuineEntry[] = [{ id: 'cache', pr_number: null,
    bullet: { text: 'Prevent stale cache entries.', category: 'fix', cites: [sha] } }];
  return { id, repository, gitlog, entries: JSON.stringify(entries), range: makeRange(id, repository, gitlog, entries) };
}
function sampleFor(range: RangeData, dataset: string, config: string): AuditSample {
  // Sixty authored cases exercise the import contract; they are never reported as live product evidence.
  return { schema: 'audit-sample.v1', dataset, config, seed: 2901,
    cases: Array.from({ length: 60 }, (_, i) => makeAuditCase(range, range.entries[0]!.bullet, i, i < 59)),
    provenance: { dataset, config, prompt: 'synthetic-test-prompt', model: 'synthetic-test-model',
      price: 'synthetic-test-price', mode: 'synthetic-authored audit fixture' } };
}
async function prepareHeldout(): Promise<{ devSample: AuditSample; heldout: RangeData }> {
  const ranges = [authoredRange(0), authoredRange(1)]; const config = await configVersion();
  const splits = repositorySplits(ranges.map((range) => range.repository), 2901);
  const manifest: GoldManifest = { schema: 'gold-manifest.v1', seed: 2901, frozen_on: '2026-10-24',
    target: { ranges: 20, repositories: 8 }, qualified_ranges: 2, qualified_repositories: 2, target_status: 'unmet', screening: [],
    ranges: ranges.map((range) => ({ id: range.id, repository: range.repository, split: splits.get(range.repository)!, from_ref: 'v1', to_ref: 'v2',
      gitlog: `gold/ranges/${range.id}.gitlog.v1.json`, gitlog_sha256: digest(range.gitlog),
      entries: `gold/ranges/${range.id}.entries.json`, entries_sha256: digest(range.entries) })) };
  const manifestText = put('gold/manifest.json', manifest);
  for (const range of ranges) {
    artifacts.files.set(insideRoot(`gold/ranges/${range.id}.gitlog.v1.json`), range.gitlog);
    artifacts.files.set(insideRoot(`gold/ranges/${range.id}.entries.json`), range.entries);
  }
  const dev = ranges.find((range) => splits.get(range.repository) === 'dev')!.range;
  const heldout = ranges.find((range) => splits.get(range.repository) === 'heldout')!.range;
  const devDataset = digest(JSON.stringify([[dev.id, dev.fingerprint]]));
  const freeze: DevFreeze = { schema: 'dev-freeze.v1', manifest: digest(manifestText), config, seed: 2901, dev_dataset: devDataset };
  put('gold/dev-freeze.json', freeze);
  put('fixtures/recorded/INDEX.json', { schema: 'recorded-index.v1', recordings: [] });
  const devSample = sampleFor(dev, devDataset, config);
  put('gold/audit-sample-dev.json', devSample);
  put('gold/audit.json', { schema: 'audit.v1', dataset: devDataset, config,
    labels: devSample.cases.map((entry) => ({ id: entry.id, label: 'supported' })) });
  return { devSample, heldout };
}
function readyAudit(heldout: RangeData): AuditSample {
  const emitted = get<AuditSample>('gold/audit-sample-heldout.json');
  const sample = sampleFor(heldout, emitted.dataset, emitted.config);
  const sampleText = put('gold/audit-sample-heldout.json', sample);
  const marker = get<Record<string, unknown>>('gold/heldout-once.json');
  put('gold/heldout-once.json', { ...marker, audit_sample_sha256: digest(sampleText) });
  return sample;
}

beforeEach(() => { artifacts.files.clear(); artifacts.reads.length = 0; });
describe('heldout audit artifact isolation (authored source only)', () => {
  it('leaves valid dev labels in place while completing heldout and writing its report/receipt', async () => {
    // what_bug_this_catches: dev dataset labels used to fail heldout after its exclusive marker was reserved.
    const { devSample } = await prepareHeldout();
    const devLabels = artifacts.files.get(insideRoot('gold/audit.json'));
    await main(['--split', 'heldout', '--seed', '2901', '--heldout-once']);
    const marker = get<{ status: string; dataset: string; report_sha256: string; audit_sample_sha256: string }>('gold/heldout-once.json');
    const report = artifacts.files.get(insideRoot('docs/results-heldout.md'))!;
    expect(marker.status).toBe('complete');
    expect(marker.dataset).not.toBe(devSample.dataset);
    expect(marker.report_sha256).toBe(digest(report));
    expect(marker.audit_sample_sha256).toBe(digest(artifacts.files.get(insideRoot('gold/audit-sample-heldout.json'))!));
    expect(artifacts.files.get(insideRoot('docs/results.md'))).toBe(report);
    expect(report).toContain('## C. Human audit\n\n');
    expect(report).toContain('heldout evaluation never reads this file');
    expect(artifacts.files.get(insideRoot('gold/audit.json'))).toBe(devLabels);
    expect(artifacts.reads).not.toContain(insideRoot('gold/audit.json'));
  });
  it('still rejects dev labels during explicit heldout import without changing the completed report/receipt', async () => {
    await prepareHeldout();
    await main(['--split', 'heldout', '--heldout-once']);
    const before = [...artifacts.files];
    await expect(main(['--split', 'heldout', '--audit-only'])).rejects.toThrow('audit dataset/config lineage mismatch');
    expect([...artifacts.files]).toEqual(before);
  });
  it('imports exact heldout labels from frozen cases without reopening range or recording artifacts', async () => {
    const { heldout } = await prepareHeldout();
    await main(['--split', 'heldout', '--heldout-once']);
    const sample = readyAudit(heldout);
    put('gold/audit.json', { schema: 'audit.v1', dataset: sample.dataset, config: sample.config,
      labels: sample.cases.map((entry, i) => ({ id: entry.id, label: i < 59 ? 'supported' : 'unsupported' })) });
    artifacts.reads.length = 0;
    await main(['--split', 'heldout', '--audit-only']);
    const report = artifacts.files.get(insideRoot('docs/results-heldout.md'))!;
    expect(report).toContain('kept precision 59/59 (100.00%); unsupported dropped 1/1 (100.00%)');
    expect(get<{ report_sha256: string }>('gold/heldout-once.json').report_sha256).toBe(digest(report));
    expect(artifacts.reads).toEqual(['gold/heldout-once.json', 'docs/results-heldout.md', 'gold/audit-sample-heldout.json', 'gold/audit.json'].map(insideRoot));
  });
  it('rejects changed configuration or duplicate sample IDs on explicit import', async () => {
    const { heldout } = await prepareHeldout();
    await main(['--split', 'heldout', '--heldout-once']);
    const sample = readyAudit(heldout);
    const labels = sample.cases.map((entry) => ({ id: entry.id, label: 'supported' }));
    put('gold/audit.json', { schema: 'audit.v1', dataset: sample.dataset, config: 'changed', labels });
    await expect(main(['--split', 'heldout', '--audit-only'])).rejects.toThrow('audit dataset/config lineage mismatch');
    put('gold/audit.json', { schema: 'audit.v1', dataset: sample.dataset, config: sample.config, labels: labels.map(() => labels[0]!) });
    await expect(main(['--split', 'heldout', '--audit-only'])).rejects.toThrow('exact seeded live sample');
  });
  it('freezes the claim, resolved citations and sanitized evidence independently of mutable source arrays', () => {
    // what_bug_this_catches: an opaque id/hash cannot be labelled without reconstructing the replay ordering.
    const { range } = authoredRange(0); const sha = range.entries[0]!.bullet.cites[0]!;
    const bullet = { ...range.entries[0]!.bullet, cites: [sha.slice(0, 12), 'f'.repeat(40)] };
    const snapshot = makeAuditCase(range, bullet, 7, false);
    expect(snapshot.bullet).toEqual(bullet);
    expect(snapshot.source).toEqual({ range: range.id, repository: range.repository, fingerprint: range.fingerprint, bullet_index: 7 });
    expect(snapshot.evidence.cites).toEqual([{ cite: sha.slice(0, 12), status: 'resolved', sha, active: true },
      { cite: 'f'.repeat(40), status: 'not_found', rejectedCode: null }]);
    expect(snapshot.evidence.commits).toEqual([{ sha, subject: 'fix: prevent stale cache entries',
      body: 'Discard stale cache entries before returning a result.', paths: ['src/cache.ts'], active: true, revert_state: 'active' }]);
    bullet.cites.length = 0; range.facts.commits.get(sha)!.paths.push('later.ts');
    expect(snapshot.bullet.cites).toHaveLength(2);
    expect(snapshot.evidence.commits[0]!.paths).toEqual(['src/cache.ts']);
  });
  it('preserves ambiguous outside/rejected candidates without inventing or dereferencing their missing text', () => {
    // what_bug_this_catches: a resolver candidate need not be an accepted commit with retained text.
    const { range } = authoredRange(0); const sha = range.entries[0]!.bullet.cites[0]!;
    const outside = `${sha.slice(0, 12)}${'2'.repeat(28)}`;
    const rejected = `${sha.slice(0, 12)}${'3'.repeat(28)}`;
    const facts = { ...range.facts, outside: new Set([outside]), rejected: new Map([[rejected, 'bad_body' as const]]) };
    const snapshot = makeAuditCase({ ...range, facts }, { ...range.entries[0]!.bullet, cites: [sha.slice(0, 12)] }, 0, false);
    expect(snapshot.evidence.cites).toEqual([{ cite: sha.slice(0, 12), status: 'ambiguous', candidates: [sha, outside, rejected] }]);
    expect(snapshot.evidence.commits.map((commit) => commit.sha)).toEqual([sha]);
  });
});
