import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../supabase/functions/_shared/core/limits.ts';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import type { ParseResult, SanitizedLog } from '../../src/core/gitlog/schema.ts';

const sha = (n: number): string => n.toString(16).padStart(40, '0');

function commit(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sha: sha(n),
    parents: n > 1 ? [sha(n - 1)] : [],
    date: '2026-10-01T12:00:00+00:00',
    subject: `feat: change ${n}`,
    body: '',
    files: [{ path: `src/file${n}.ts`, added: 1, deleted: 0 }],
    ...overrides,
  };
}

function logText(commits: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: 'gitlog.v1', repo_label: 'synthetic/demo', from_ref: 'v1.0.0', to_ref: 'v1.1.0', commits, ...extra });
}

function okLog(result: ParseResult): SanitizedLog {
  if (!result.ok) throw new Error(`expected ok, got ${result.report.fileError?.code}`);
  return result.log;
}

afterEach(() => vi.restoreAllMocks());

describe('parseLog file-level limits', () => {
  it('accepts a well-formed log, including an empty range', () => {
    const result = parseLog(logText([commit(1), commit(2)]));
    expect(okLog(result).commits.map((c) => c.sha)).toEqual([sha(1), sha(2)]);
    expect(result.report.accepted).toBe(2);
    expect(okLog(parseLog(logText([]))).commits).toEqual([]);
  });

  it('refuses more than maxFileBytes by UTF-8 byte length before JSON.parse', () => {
    const parse = vi.spyOn(JSON, 'parse');
    // 2,600,000 two-byte characters: under the limit in UTF-16 units, over it in UTF-8 bytes.
    const text = 'é'.repeat(2_600_000);
    expect(text.length).toBeLessThan(LIMITS.maxFileBytes);
    const result = parseLog(text);
    expect(result.ok).toBe(false);
    expect(result.report.fileError?.code).toBe('too_large');
    expect(parse).not.toHaveBeenCalled();
  });

  it('refuses more than maxCommits commits', () => {
    const commits = Array.from({ length: LIMITS.maxCommits + 1 }, (_, i) => commit(i + 1));
    const result = parseLog(logText(commits));
    expect(result.ok).toBe(false);
    expect(result.report.fileError?.code).toBe('too_many_commits');
  });

  it('refuses invalid JSON, wrong schema and bad header fields', () => {
    expect(parseLog('{not json').report.fileError?.code).toBe('not_json');
    expect(parseLog(JSON.stringify({ schema: 'gitlog.v2', commits: [] })).report.fileError?.code).toBe('bad_schema');
    expect(parseLog(logText([], { to_ref: '' })).report.fileError?.code).toBe('bad_header');
    expect(parseLog(logText([], { commits: {} })).report.fileError?.code).toBe('bad_schema');
  });
});

describe('parseLog record-level rejection', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['body over maxBodyChars', { body: 'x'.repeat(LIMITS.maxBodyChars + 1) }, 'body_too_long'],
    [
      'more than maxFilesPerCommit files',
      { files: Array.from({ length: LIMITS.maxFilesPerCommit + 1 }, (_, i) => ({ path: `f${i}`, added: 0, deleted: 0 })) },
      'too_many_files',
    ],
    ['parent that is not a sha', { parents: ['HEAD~1'] }, 'bad_parents'],
    ['date that is not ISO-8601', { date: 'Oct 1 2026' }, 'bad_date'],
    ['negative count', { files: [{ path: 'a.ts', added: -1, deleted: 0 }] }, 'bad_counts'],
    ['fractional count', { files: [{ path: 'a.ts', added: 1.5, deleted: 0 }] }, 'bad_counts'],
    ['missing count', { files: [{ path: 'a.ts', added: 1 }] }, 'bad_counts'],
    ['empty path', { files: [{ path: '', added: 1, deleted: 0 }] }, 'bad_file'],
    ['non-string body', { body: 42 }, 'bad_body'],
  ];

  it.each(cases)('rejects only the record with %s, keeping its sha and index', (_label, overrides, code) => {
    const result = parseLog(logText([commit(1), commit(2, overrides), commit(3)]));
    const log = okLog(result);
    expect(log.commits.map((c) => c.sha)).toEqual([sha(1), sha(3)]);
    expect(log.rejected).toEqual([{ index: 1, sha: sha(2), code }]);
    expect(result.report.rejectedByCode[code as keyof typeof result.report.rejectedByCode]).toBe(1);
  });

  it('rejects a non-finite count (1e999 parses to Infinity)', () => {
    const text = logText([commit(1)]).replace('"added":1', '"added":1e999');
    expect(okLog(parseLog(text)).rejected).toEqual([{ index: 0, sha: sha(1), code: 'bad_counts' }]);
  });

  it('rejects a malformed sha without inventing one', () => {
    const log = okLog(parseLog(logText([commit(1, { sha: 'abc123' })])));
    expect(log.rejected).toEqual([{ index: 0, code: 'bad_sha' }]);
  });

  it('rejects every record carrying a duplicated sha', () => {
    const log = okLog(parseLog(logText([commit(1), commit(2), commit(2, { subject: 'fix: other' })])));
    expect(log.commits.map((c) => c.sha)).toEqual([sha(1)]);
    expect(log.rejected).toEqual([
      { index: 1, sha: sha(2), code: 'duplicate_sha' },
      { index: 2, sha: sha(2), code: 'duplicate_sha' },
    ]);
  });

  it('keeps binary numstat as null and normalises upper-case shas', () => {
    const log = okLog(parseLog(logText([commit(1, { sha: sha(1).toUpperCase(), files: [{ path: 'logo.png', added: null, deleted: null }] })])));
    expect(log.commits[0]?.sha).toBe(sha(1));
    expect(log.commits[0]?.files).toEqual([{ path: 'logo.png', added: null, deleted: null }]);
  });
});

describe('parseLog outside_shas', () => {
  it('accepts up to maxOutsideShas unique full shas disjoint from the commits', () => {
    const outside = [sha(900), sha(901)];
    const result = parseLog(logText([commit(1)], { outside_shas: outside }));
    expect(okLog(result).outside_shas).toEqual(outside);
    expect(result.report.outsideShas).toBe(2);
  });

  it.each([
    ['too many', Array.from({ length: LIMITS.maxOutsideShas + 1 }, (_, i) => sha(10_000 + i)), 'too_many_outside_shas'],
    ['a short sha', ['abc1234'], 'bad_outside_shas'],
    ['a duplicate', [sha(900), sha(900)], 'bad_outside_shas'],
    ['a supplied commit sha', [sha(1)], 'outside_shas_overlap'],
    ['not an array', 'abc', 'bad_outside_shas'],
  ])('refuses the file for %s', (_label, outside, code) => {
    const result = parseLog(logText([commit(1)], { outside_shas: outside }));
    expect(result.ok).toBe(false);
    expect(result.report.fileError?.code).toBe(code);
  });

  it('treats a rejected record sha as supplied (overlap still refused)', () => {
    const result = parseLog(logText([commit(1, { body: 'x'.repeat(LIMITS.maxBodyChars + 1) })], { outside_shas: [sha(1)] }));
    expect(result.report.fileError?.code).toBe('outside_shas_overlap');
  });
});

describe('config/limits.json mirror', () => {
  it('equals the shared LIMITS constants', () => {
    const json: unknown = JSON.parse(readFileSync(new URL('../../config/limits.json', import.meta.url), 'utf8'));
    expect(json).toEqual({ ...LIMITS });
  });
});
