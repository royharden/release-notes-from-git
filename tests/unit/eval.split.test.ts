import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertHeldoutFrozen, assertSplitIsolation, repositorySplits, reserveHeldout } from '../../scripts/eval.ts';
import type { DevFreeze, GoldManifest } from '../../scripts/eval.ts';

function manifest(): GoldManifest {
  const repositories = Array.from({ length: 8 }, (_, i) => `example/repo-${i}`);
  const splits = repositorySplits(repositories, 2901);
  return { schema: 'gold-manifest.v1', seed: 2901, frozen_on: '2026-10-24', target: { ranges: 20, repositories: 8 },
    qualified_ranges: 8, qualified_repositories: 8, target_status: 'unmet', screening: [], ranges: repositories.map((repository, i) => ({
      id: `range-${i}`, repository, split: splits.get(repository)!, from_ref: 'v1', to_ref: 'v2',
      gitlog: `gold/ranges/range-${i}.gitlog.v1.json`, gitlog_sha256: i.toString(16).padStart(64, '0'),
      entries: `gold/ranges/range-${i}.entries.json`, entries_sha256: (i + 16).toString(16).padStart(64, '0'),
    })) };
}
describe('frozen repository splits', () => {
  it('is deterministic independent of candidate ordering and flags partial evidence without reducing20/8', () => {
    const m = manifest();
    expect([...repositorySplits(m.ranges.map((r) => r.repository), 2901)]).toEqual([...repositorySplits(m.ranges.map((r) => r.repository).reverse(), 2901)]);
    expect(() => assertSplitIsolation(m)).not.toThrow();
    m.target_status = 'met'; expect(() => assertSplitIsolation(m)).toThrow('target status');
  });
  it('rejects two ranges from one repository leaking across splits, including case changes', () => {
    const m = manifest(); const first = m.ranges[0]!;
    m.ranges.push({ ...first, id: 'leak', to_ref: 'v3', repository: first.repository.toUpperCase(), split: first.split === 'dev' ? 'heldout' : 'dev' });
    m.qualified_ranges++;
    expect(() => assertSplitIsolation(m)).toThrow('split leak');
  });
  it('rejects identical artifact hashes under different repository labels across dev/heldout', () => {
    const m = manifest(); const dev = m.ranges.find((r) => r.split === 'dev')!; const heldout = m.ranges.find((r) => r.split === 'heldout')!;
    heldout.gitlog_sha256 = dev.gitlog_sha256;
    expect(() => assertSplitIsolation(m)).toThrow('artifact crosses');
  });
  it('requires the exact dev-frozen config, manifest and mutation seed', () => {
    const freeze: DevFreeze = { schema: 'dev-freeze.v1', manifest: 'manifest', config: 'config', seed: 2901, dev_dataset: 'a'.repeat(64) };
    expect(() => assertHeldoutFrozen(freeze, 'manifest', 'config', 2901)).not.toThrow();
    expect(() => assertHeldoutFrozen(freeze, 'changed', 'config', 2901)).toThrow();
    expect(() => assertHeldoutFrozen(freeze, 'manifest', 'changed', 2901)).toThrow();
    expect(() => assertHeldoutFrozen(freeze, 'manifest', 'config', 42)).toThrow();
  });
  it('exclusively consumes heldout before evaluation and preserves its first reservation on retry', () => {
    // what_bug_this_catches: check-then-write permits concurrent heldout runs and deleting failures permits tuning.
    const directory = mkdtempSync(join(tmpdir(), 's29-heldout-'));
    const marker = join(directory, 'once.json');
    const freeze: DevFreeze = { schema: 'dev-freeze.v1', manifest: 'm', config: 'c', seed: 2901, dev_dataset: 'a'.repeat(64) };
    try {
      reserveHeldout(marker, freeze); const first = readFileSync(marker, 'utf8');
      expect(() => reserveHeldout(marker, freeze)).toThrow();
      expect(readFileSync(marker, 'utf8')).toBe(first);
    } finally { unlinkSync(marker); rmdirSync(directory); }
  });
});
