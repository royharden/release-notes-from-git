import { describe, expect, it } from 'vitest';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import { baseUrlProblem, containsEmail, createRedactionCounts, redactEmails, stripNameTrailers } from '../../src/core/gitlog/redact.ts';
import { SANITIZED_COMMIT_FIELDS, SANITIZED_FILE_FIELDS } from '../../src/core/gitlog/schema.ts';
import type { SanitizedLog } from '../../src/core/gitlog/schema.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SECRET_NAME = 'Zelda Quinlan-Okafor';
const SECRET_EMAIL = 'zelda.q@example-mail.org';

function parseOk(input: Record<string, unknown>): { log: SanitizedLog; reportJson: string; logJson: string } {
  const result = parseLog(JSON.stringify(input));
  if (!result.ok) throw new Error('expected ok');
  return { log: result.log, reportJson: JSON.stringify(result.report), logJson: JSON.stringify(result.log) };
}

const hostile = {
  schema: 'gitlog.v1',
  repo_label: `team ${SECRET_EMAIL} repo`,
  from_ref: `release/${SECRET_EMAIL}`,
  to_ref: 'v1.1.0',
  base_url: 'https://github.com/synthetic/demo',
  authors: [SECRET_NAME],
  commits: [
    {
      sha: SHA_A,
      parents: [],
      date: '2026-10-01T12:00:00Z',
      subject: `feat: contact ${SECRET_EMAIL} for access`,
      body: [
        'Adds the export button.',
        '',
        `Signed-off-by: ${SECRET_NAME} <${SECRET_EMAIL}>`,
        `Co-authored-by: ${SECRET_NAME} <${SECRET_EMAIL}>`,
        `reviewed-by: ${SECRET_NAME}`,
        `Reported-By: ${SECRET_NAME}`,
        `Acked-by: ${SECRET_NAME}`,
        `Cc: ${SECRET_NAME}`,
        'Fixes #12',
        '(cherry picked from commit ' + SHA_B + ')',
      ].join('\n'),
      author: SECRET_NAME,
      author_email: SECRET_EMAIL,
      committer: { name: SECRET_NAME, email: SECRET_EMAIL },
      files: [{ path: `docs/${SECRET_EMAIL}.md`, added: 1, deleted: 0 }],
    },
  ],
};

describe('redaction at parse time', () => {
  it('removes email-like strings from subject, body, paths, refs and repo_label', () => {
    const { log, logJson } = parseOk(hostile);
    expect(logJson).not.toContain(SECRET_EMAIL);
    expect(containsEmail(logJson)).toBe(false);
    expect(log.repo_label).toBe('team [email removed] repo');
    expect(log.from_ref).toBe('release/[email removed]');
    expect(log.commits[0]?.subject).toBe('feat: contact [email removed] for access');
    // The domain match is greedy: `.md` reads as a further domain label and is removed with the address.
    expect(log.commits[0]?.files[0]?.path).toBe('docs/[email removed]');
  });

  it('drops every name-carrying trailer line and keeps issue refs and cherry-pick trailers', () => {
    const { log } = parseOk(hostile);
    const body = log.commits[0]?.body ?? '';
    expect(body).not.toContain(SECRET_NAME);
    expect(body).toContain('Fixes #12');
    expect(body).toContain(`(cherry picked from commit ${SHA_B})`);
    expect(body.startsWith('Adds the export button.')).toBe(true);
  });

  it('drops author fields so no author, committer or email key exists in the output', () => {
    const { log, logJson } = parseOk(hostile);
    expect(logJson).not.toContain(SECRET_NAME);
    for (const c of log.commits) {
      expect(Object.keys(c).sort()).toEqual([...SANITIZED_COMMIT_FIELDS].sort());
      for (const f of c.files) expect(Object.keys(f).sort()).toEqual([...SANITIZED_FILE_FIELDS].sort());
    }
    expect(Object.keys(log)).not.toContain('authors');
  });

  it('reports counts by kind without echoing removed text', () => {
    const result = parseLog(JSON.stringify(hostile));
    const reportJson = JSON.stringify(result.report);
    expect(reportJson).not.toContain(SECRET_NAME);
    expect(reportJson).not.toContain(SECRET_EMAIL);
    expect(result.report.redactions.name_trailer).toBe(6);
    // repo_label, from_ref, subject, path: four email strings outside trailers.
    expect(result.report.redactions.email).toBe(4);
    // top-level `authors` plus author, author_email, committer on the commit.
    expect(result.report.redactions.author_field).toBe(4);
  });

  it('discards a base_url that carries credentials', () => {
    const { log } = parseOk({ ...hostile, base_url: 'https://user:token@github.com/synthetic/demo' });
    expect(log.base_url).toBeNull();
  });

  it.each([
    ['path', `https://git.example.com/${SECRET_EMAIL}/repo`],
    ['query', `https://git.example.com/x?owner=${SECRET_EMAIL}`],
    ['fragment', `https://git.example.com/x#${SECRET_EMAIL}`],
  ])('discards a base_url with an email in its %s', (_label, base_url) => {
    const result = parseLog(JSON.stringify({ ...hostile, base_url }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.log.base_url).toBeNull();
    expect(JSON.stringify(result.log)).not.toContain(SECRET_EMAIL);
    // The four email strings outside trailers plus the one in base_url.
    expect(result.report.redactions.email).toBe(5);
    expect(result.report.redactions.credential_url).toBe(0);
  });

  it('classifies an unparseable base_url holding an address as email, other "@" as credential_url', () => {
    expect(baseUrlProblem(`not a url ${SECRET_EMAIL}`)).toBe('email');
    expect(baseUrlProblem('not a url zelda.q%40example-mail.org')).toBe('email');
    expect(baseUrlProblem('not a url user@host')).toBe('credential_url');
    expect(baseUrlProblem('not a url')).toBeNull();
  });

  it('applies only email redaction to a subject, so a trailer-like subject survives', () => {
    const commit = { ...hostile.commits[0], subject: 'Author: update the contributing guide' };
    const { log } = parseOk({ ...hostile, commits: [commit] });
    expect(log.commits[0]?.subject).toBe('Author: update the contributing guide');
  });
});

describe('redaction helpers', () => {
  it('leaves package specs and scopes that look like emails intact', () => {
    const counts = createRedactionCounts();
    const text = 'bump lodash@4.17.21 and @types/node@22.15.21 and @supabase/supabase-js';
    expect(redactEmails(text, counts)).toBe(text);
    expect(counts.email).toBe(0);
  });

  it('matches trailer names case-insensitively and leaves prose mentioning "by" alone', () => {
    const counts = createRedactionCounts();
    const out = stripNameTrailers('Tested-by: someone\nSuggested-By: someone\nCaused by: a race\nnearby: ok', counts);
    expect(out).toBe('Caused by: a race\nnearby: ok');
    expect(counts.name_trailer).toBe(2);
  });
});
