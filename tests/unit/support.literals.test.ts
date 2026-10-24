import { describe, expect, it } from 'vitest';
import { extractLiterals, missingLiterals } from '../../src/core/support/literals.ts';
import type { LiteralKind } from '../../src/core/support/literals.ts';
import { supportScore } from '../../src/core/support/score.ts';
import { tokenize } from '../../src/core/support/tokenize.ts';

const cases: { kind: LiteralKind; literal: string; present: string; absent: string }[] = [
  { kind: 'number', literal: '3', present: 'Retries 3 times.', absent: 'Retries 13 times.' },
  { kind: 'number', literal: '20%', present: 'Savings 20%.', absent: 'Savings 120%.' },
  { kind: 'version', literal: 'v1.2.3-rc.1', present: 'Version v1.2.3-rc.1.', absent: 'Version V1.2.3-rc.1.' },
  { kind: 'date', literal: '2026-10-24', present: 'On 2026-10-24.', absent: 'On 2026-10-25.' },
  { kind: 'issue', literal: '#123', present: 'Fixes #123.', absent: 'Fixes #1234.' },
  { kind: 'backtick', literal: 'caféMode', present: 'cafe\u0301Mode', absent: 'CafeMode' },
  { kind: 'flag', literal: '--retry', present: 'Use --retry.', absent: 'Use --retries.' },
  { kind: 'url', literal: 'https://example.test/Case', present: 'https://example.test/Case', absent: 'https://example.test/case' },
  { kind: 'cve', literal: 'CVE-2026-12345', present: 'CVE-2026-12345', absent: 'cve-2026-12345' },
];

describe('literal classes are verbatim after NFC', () => {
  it.each(cases)('$kind: $literal has pass and fail evidence', ({ kind, literal, present, absent }) => {
    const text = kind === 'backtick' ? `Use \`${literal}\`.` : `Use ${literal}.`;
    expect(extractLiterals(text)).toContainEqual({ kind, value: literal });
    expect(missingLiterals(text, present)).toEqual([]);
    expect(missingLiterals(text, absent)).toContain(literal);
  });

  it('does not find a single digit inside a decimal, or treat number words as literals', () => {
    expect(missingLiterals('3 retries', '1.3 retries')).toEqual(['3']);
    expect(extractLiterals('three retries')).toEqual([]);
  });

  it('does not double-count numbers nested in URL, date, version, issue or CVE literals', () => {
    expect(extractLiterals('v1.2 on 2026-10-24, #12, CVE-2026-12345, https://example.test/123'))
      .toHaveLength(5);
  });
});

describe('lexical support proxy', () => {
  it('splits camelCase, PascalCase, snake_case and paths', () => {
    expect(tokenize('parseHTTPHeader snake_case src/cacheStore.ts 3')).toEqual(['parse', 'http', 'header', 'snake', 'case', 'src', 'cache', 'store', 'ts']);
  });
  it('scores found/total informative terms and fails zero-token bullets without NaN', () => {
    expect(supportScore('Various improvements.', 'anything')).toEqual({ score: 0, matched: [], unmatched: [], total: 0 });
    expect(supportScore('Cache manifests quickly', 'cache manifests')).toMatchObject({ score: 2 / 3, total: 3 });
  });
});
