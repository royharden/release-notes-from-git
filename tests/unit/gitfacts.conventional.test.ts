import { describe, expect, it } from 'vitest';
import { DEFAULT_IGNORE } from '../../src/core/config.ts';
import { parseConventional } from '../../src/core/gitfacts/conventional.ts';
import { isNonProductPath, noiseReason } from '../../src/core/gitfacts/noise.ts';
import { issueRefs, mergePrNumber, squashPrNumber, stripPrSuffix } from '../../src/core/gitfacts/pr.ts';
import { cherrySource } from '../../src/core/gitfacts/cherry.ts';

describe('parseConventional', () => {
  it.each([
    ['feat(parser): support tabs', '', { type: 'feat', scope: 'parser', bang: false, breakingFooter: false, description: 'support tabs' }],
    ['fix: handle empty input', '', { type: 'fix', scope: null, bang: false, breakingFooter: false, description: 'handle empty input' }],
    ['feat(api)!: remove v1', '', { type: 'feat', scope: 'api', bang: true, breakingFooter: false, description: 'remove v1' }],
    ['refactor!: drop the old loader', '', { type: 'refactor', scope: null, bang: true, breakingFooter: false, description: 'drop the old loader' }],
    ['FEAT(Core): Upper-case type', '', { type: 'feat', scope: 'Core', bang: false, breakingFooter: false, description: 'Upper-case type' }],
    ['feat(config): read toml', 'Details.\n\nBREAKING CHANGE: json is gone.', { type: 'feat', scope: 'config', bang: false, breakingFooter: true, description: 'read toml' }],
    ['feat(config): read toml', 'BREAKING-CHANGE: json is gone.', { type: 'feat', scope: 'config', bang: false, breakingFooter: true, description: 'read toml' }],
  ])('parses %s', (subject, body, expected) => {
    expect(parseConventional(subject, body)).toEqual(expected);
  });

  it.each([
    ['Add a settings page'],
    ['WIP: experiment'],
    ['Note: this is prose'],
    ['Revert "feat: x"'],
    ['Merge pull request #12 from org/branch'],
    ['fixup! feat(ui): add tokens'],
    ['feat:missing space'],
  ])('leaves %s untyped (unknown)', (subject) => {
    expect(parseConventional(subject, '').type).toBe('unknown');
  });

  it('does not read a lower-case or mid-line "breaking change" as a footer', () => {
    expect(parseConventional('fix: x', 'this is a breaking change: maybe').breakingFooter).toBe(false);
    expect(parseConventional('fix: x', 'See BREAKING CHANGE: below').breakingFooter).toBe(false);
  });
});

describe('PR ids and issue refs', () => {
  it('reads a squash suffix and a GitHub merge subject', () => {
    expect(squashPrNumber('feat: add csv export (#101)')).toBe(101);
    expect(squashPrNumber('feat: add csv export (#101) ')).toBe(101);
    expect(squashPrNumber('feat: mention (#101) mid-subject')).toBeNull();
    expect(mergePrNumber('Merge pull request #117 from synthetic/dark-theme')).toBe(117);
    expect(mergePrNumber("Merge branch 'release/1.4' into main")).toBeNull();
    expect(stripPrSuffix('feat: add csv export (#101)')).toBe('feat: add csv export');
  });

  it('records Fixes/Closes/Resolves #N as issue refs, never as PR ids', () => {
    expect(issueRefs('fix(parser): keep quoted newlines', 'Fixes #140\nCloses #141, resolves #140')).toEqual([140, 141]);
    expect(squashPrNumber('fix: crash. Fixes #140')).toBeNull();
    expect(issueRefs('fix: prefix', 'prefixes #9 is not a keyword')).toEqual([]);
  });

  it('reads only an explicit full-sha cherry-pick trailer', () => {
    const sha = 'ab'.repeat(20);
    expect(cherrySource(`Backport.\n\n(cherry picked from commit ${sha})`)).toBe(sha);
    expect(cherrySource('(cherry picked from commit abcdef1)')).toBeNull();
    expect(cherrySource('cherry picked from the release branch')).toBeNull();
  });
});

describe('noise and the ignore list', () => {
  const base = { isMerge: false, prNumber: null };
  it.each([
    [{ ...base, subject: "Merge branch 'x'", type: 'unknown', isMerge: true }, 'merge_without_pr'],
    [{ ...base, subject: 'fixup! fix: x', type: 'unknown' }, 'fixup'],
    [{ ...base, subject: 'squash! fix: x', type: 'unknown' }, 'squash'],
    [{ ...base, subject: 'amend! fix: x', type: 'unknown' }, 'amend'],
    [{ ...base, subject: 'WIP: streaming', type: 'unknown' }, 'wip'],
    [{ ...base, subject: '[WIP] streaming', type: 'unknown' }, 'wip'],
    [{ ...base, subject: 'chore: bump', type: 'chore' }, 'ignored_type'],
    [{ ...base, subject: 'docs: guide', type: 'docs' }, 'ignored_type'],
  ])('classifies %o as %s', (input, reason) => {
    expect(noiseReason(input, DEFAULT_IGNORE)).toBe(reason);
  });

  it('never applies the ignore list to untyped commits, and keeps merges with a PR id', () => {
    expect(noiseReason({ ...base, subject: 'Update docs', type: 'unknown' }, { ...DEFAULT_IGNORE, ignoredTypes: ['unknown'] })).toBeNull();
    expect(noiseReason({ subject: 'Merge pull request #5 from a/b', type: 'unknown', isMerge: true, prNumber: 5 }, DEFAULT_IGNORE)).toBeNull();
    expect(noiseReason({ ...base, subject: 'Wipe the cache on logout', type: 'unknown' }, DEFAULT_IGNORE)).toBeNull();
  });

  it('classifies docs, tests, CI and lockfiles as non-product paths', () => {
    const rule = DEFAULT_IGNORE.nonProductPaths;
    for (const p of ['docs/guide.md', 'README.md', 'tests/a.test.ts', 'src/__tests__/x.ts', '.github/workflows/ci.yml', 'package-lock.json', 'web/yarn.lock']) {
      expect(isNonProductPath(p, rule)).toBe(true);
    }
    for (const p of ['src/app.ts', 'package.json', 'src/testing-utils.ts', 'lib/docsify.ts']) expect(isNonProductPath(p, rule)).toBe(false);
  });
});
