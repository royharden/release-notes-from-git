import { describe, expect, it } from 'vitest';
import { buildLogArgs, buildOutsideArgs, parseLogOutput, validateRef } from '../../scripts/export-git-log.ts';
import { readText } from '../helpers/fixtures.ts';

const sha = 'a'.repeat(40);
const parent = 'b'.repeat(40);
const frame = (stats: string) => `\u001e${sha}\0${parent}\0${'2026-10-24T12:00:00Z'}\0fix: binary assets\0Details.\n\0\n${stats}`;

describe('git export command and framing', () => {
  it.each(['HEAD', 'v1.2.3', 'release/next', 'a'.repeat(40)])('permits plain ref %s', (ref) => expect(validateRef(ref)).toBeNull());
  it.each(['-x', 'a..b', 'HEAD~3', 'tag^', 'main@{1}', 'x\n', 'a b', 'x;touch', 'x'.repeat(201)])('refuses unsafe ref %s', (ref) => expect(validateRef(ref)).not.toBeNull());
  it('places global args before log and end-of-options before the range', () => {
    const argv = buildLogArgs('C:/trusted repo', 'v1', 'HEAD');
    const log = argv.indexOf('log');
    expect(argv.indexOf('--no-pager')).toBeLessThan(log);
    expect(argv.indexOf('core.fsmonitor=false')).toBeLessThan(log);
    expect(argv.slice(-2)).toEqual(['--end-of-options', 'v1..HEAD']);
    expect(argv).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv', '--no-show-signature', '--numstat', '-z']));
    expect(buildOutsideArgs('.', 'v1', 5)).toEqual(expect.arrayContaining(['--max-count=5', '--format=%H']));
  });
  it('parses NUL-framed fields, binary null counts and renamed paths without JSON guessing', () => {
    const parsed = parseLogOutput(frame('-\t-\tassets/logo.png\0' + '2\t1\t\0old path.ts\0new path.ts\0'));
    expect(parsed.malformed).toEqual([]);
    expect(parsed.commits).toEqual([{ sha, parents: [parent], date: '2026-10-24T12:00:00Z', subject: 'fix: binary assets', body: 'Details.',
      files: [{ path: 'assets/logo.png', added: null, deleted: null }, { path: 'new path.ts', added: 2, deleted: 1 }] }]);
    expect(parseLogOutput(frame('invalid numstat\0')).malformed).toEqual([0]);
  });
  it('preserves legal record separators in message fields and paths without splitting evidence', () => {
    const rs = '\u001e';
    const nextSha = 'c'.repeat(40);
    const subject = `fix: retain ${rs} in messages`;
    const body = `Details before ${rs}${nextSha}\nand after.`;
    const path = `src/${rs}file.ts`;
    // Both rename fields look exactly like record-start tokens; their NUL positions make them paths.
    const oldPath = `${rs}${nextSha}`;
    const newPath = `${rs}${sha}`;
    const first = `${rs}${sha}\0${parent}\0${'2026-10-24T12:00:00Z'}\0${subject}\0${body}\n\0\n`
      + `1\t0\t${path}\0` + `2\t1\t\0${oldPath}\0${newPath}\0`;
    const second = `${rs}${nextSha}\0${sha}\0${'2026-10-24T13:00:00Z'}\0fix: next commit\0Following.\n\0\n3\t0\tnext.ts\0`;
    const parsed = parseLogOutput(first + second);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.commits).toEqual([
      { sha, parents: [parent], date: '2026-10-24T12:00:00Z', subject, body,
        files: [{ path, added: 1, deleted: 0 }, { path: newPath, added: 2, deleted: 1 }] },
      { sha: nextSha, parents: [sha], date: '2026-10-24T13:00:00Z', subject: 'fix: next commit', body: 'Following.',
        files: [{ path: 'next.ts', added: 3, deleted: 0 }] },
    ]);
  });
  it('handles empty-file commits and reports malformed frames at their original indices', () => {
    const parsed = parseLogOutput(frame('') + frame('invalid numstat\0') + frame('1\t0\tsrc/next.ts\0'));
    expect(parsed.malformed).toEqual([1]);
    expect(parsed.commits.map((commit) => commit.files)).toEqual([[], [{ path: 'src/next.ts', added: 1, deleted: 0 }]]);
  });
  it('rejects unterminated metadata, numstat and rename fields instead of accepting truncated evidence', () => {
    expect(parseLogOutput(`\u001e${sha}\0${parent}\0${'2026-10-24T12:00:00Z'}\0fix: truncated\0Details.`)).toEqual({ commits: [], malformed: [0] });
    expect(parseLogOutput(frame('1\t0\tsrc/truncated.ts'))).toEqual({ commits: [], malformed: [0] });
    expect(parseLogOutput(frame('1\t0\t\0old.ts\0new.ts'))).toEqual({ commits: [], malformed: [0] });
  });
  it('uses execFile with argv, no shell, and prints the trusted-repository warning', () => {
    const source = readText('scripts/export-git-log.ts');
    expect(source).toContain("import { execFile } from 'node:child_process'");
    expect(source).toContain("run('git', buildLogArgs(");
    expect(source).not.toMatch(/shell\s*:\s*true|\bexec\s*\(/);
    expect(source).toContain('run this only on trusted repositories or a fresh clone');
    expect(source).not.toMatch(/%[anAeEcC]|%\([^)]+author/);
  });
});
