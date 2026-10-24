import { describe, expect, it } from 'vitest';
import { codeSpan, escapeInline } from '../../src/core/export/escape.ts';
import { commitLinkBase, renderBulletLine, renderMarkdown } from '../../src/core/export/markdown.ts';
import type { ExportCounts, ExportDocument, ExportedBullet } from '../../src/core/export/markdown.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const COUNTS: ExportCounts = { generated: 9, validator_kept: 6, validator_dropped: 3, human_removed: 1, human_restored: 1, human_added: 2 };

function bullet(text: string, category: ExportedBullet['category'], overrides: Partial<ExportedBullet> = {}): ExportedBullet {
  return { key: `k-${text}`, text, category, cites: [SHA], attestation: 'validator', origin: 'model', ...overrides };
}

function doc(bullets: ExportedBullet[], base_url: string | null = null): ExportDocument {
  return { version: '1.4.0', date: '2026-10-24', base_url, bullets, counts: COUNTS };
}

describe('section layout', () => {
  it('uses the fixed order, omits empty sections and puts security under Fixes with a label', () => {
    const md = renderMarkdown(
      doc([
        bullet('Other thing', 'other'),
        bullet('Faster parse', 'performance'),
        bullet('Patched token check', 'security'),
        bullet('Fixed crash', 'fix'),
        bullet('Removed v1 API', 'breaking'),
      ]),
    );
    const headings = md.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Breaking', '## Fixes', '## Performance', '## Other']);
    const fixes = md.slice(md.indexOf('## Fixes'), md.indexOf('## Performance'));
    expect(fixes).toContain('- Security: Patched token check');
    expect(fixes).toContain('- Fixed crash');
    expect(md.startsWith('# 1.4.0 (2026-10-24)\n')).toBe(true);
  });

  it('writes the six footer counts', () => {
    const md = renderMarkdown(doc([bullet('Added export', 'feature')]));
    expect(md).toContain(
      'Generated: 9; validator kept: 6; validator dropped: 3; human-removed: 1; human-restored: 1; human-added: 2',
    );
  });

  it('marks human-attested bullets visibly', () => {
    const line = renderBulletLine(bullet('Restored entry', 'fix', { attestation: 'human_attested' }), null);
    expect(line).toBe('- Restored entry [0123456] (human_attested)');
  });
});

describe('escaping commit-derived text', () => {
  it.each([
    ['<script>alert(1)</script>', '\\<script\\>alert\\(1\\)\\</script\\>'],
    ['[click](javascript:alert(1))', '\\[click\\]\\(javascript:alert\\(1\\)\\)'],
    ['![img](x.png)', '\\!\\[img\\]\\(x.png\\)'],
    ['# heading', '\\# heading'],
    ['```js', '\\`\\`\\`js'],
    ['*bold* _em_ ~strike~ | pipe $math$ &amp;', '\\*bold\\* \\_em\\_ \\~strike\\~ \\| pipe \\$math\\$ \\&amp;'],
    ['- nested list', '\\- nested list'],
    ['+ plus list', '\\+ plus list'],
    ['12. ordered', '12\\. ordered'],
    ['> quote', '\\> quote'],
    ['<https://evil.example>', '\\<`https://evil.example>`'],
    ['line one\n# line two', 'line one \\# line two'],
  ])('escapes %j', (input, expected) => {
    expect(escapeInline(input)).toBe(expected);
  });

  it('turns bare URLs, www hosts and emails into code spans so they cannot autolink', () => {
    expect(escapeInline('see https://evil.example/x?a=1 now')).toBe('see `https://evil.example/x?a=1` now');
    expect(escapeInline('www.evil.example')).toBe('`www.evil.example`');
    expect(escapeInline('mail a@b.example')).toBe('mail `a@b.example`');
  });

  it('matches www hosts case-insensitively', () => {
    expect(escapeInline('WWW.evil.example and Www.x.example')).toBe('`WWW.evil.example` and `Www.x.example`');
  });

  it('puts @mentions in code spans so GitHub cannot notify anyone', () => {
    expect(escapeInline('thanks @octocat and @synthetic-org/core-team')).toBe('thanks `@octocat` and `@synthetic-org/core-team`');
    expect(escapeInline('cc @octocat.')).toBe('cc `@octocat`.');
    // Not a mention, but GFM would autolink it as mailto:, so the email branch code-spans it.
    expect(escapeInline('bump lodash@4.17.21')).toBe('bump `lodash@4.17.21`');
    expect(escapeInline('a lone @ sign')).toBe('a lone @ sign');
  });

  it('fences code spans longer than any backtick run inside', () => {
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`x')).toBe('`` `x ``');
  });

  it('cannot create a heading, link or image inside a bullet line', () => {
    const line = renderBulletLine(bullet('# [x](https://evil.example) ![i](y)', 'feature'), null);
    expect(line.startsWith('- \\# ')).toBe(true);
    expect(line).not.toMatch(/(?<!\\)\[x\]/);
    expect(line).not.toMatch(/(?<!\\)!\[/);
  });
});

describe('commit links', () => {
  it('links only to an https base_url as <base>/commit/<full-sha>', () => {
    const md = renderMarkdown(doc([bullet('Added export', 'feature')], 'https://github.com/synthetic/demo/'));
    expect(md).toContain(`[0123456](https://github.com/synthetic/demo/commit/${SHA})`);
  });

  it.each([
    ['http scheme', 'http://github.com/synthetic/demo'],
    ['credentials', 'https://user:pw@github.com/synthetic/demo'],
    ['query', 'https://github.com/synthetic/demo?tab=1'],
    ['fragment', 'https://github.com/synthetic/demo#top'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['markdown breakout', 'https://github.com/a)(b'],
    ['whitespace', 'https://github.com/a b'],
  ])('does not link a base_url with %s', (_label, base) => {
    expect(commitLinkBase(base)).toBeNull();
    const md = renderMarkdown(doc([bullet('Added export', 'feature')], base));
    expect(md).toContain('- Added export [0123456]\n');
  });
});
