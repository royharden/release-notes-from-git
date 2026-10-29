// Export a git range as gitlog.v1.json (Node >= 22.18, native type stripping, no dependencies).
//
//   node scripts/export-git-log.ts --repo <dir> --from <ref> --to <ref> [--out <file>] [--label <text>]
//                                  [--base-url <https url>] [--outside <N>]
//
// Runs only `git log`, through execFile with an argument array (no shell). Each ref must match a conservative
// pattern (no leading "-", no "..", plain tag/branch/full sha/HEAD; `HEAD~3`, `tag^` and `@{...}` are refused) and
// the range `<from>..<to>` is built only after validation and passed after `--end-of-options` (never after `--`,
// where git reads pathspecs). Global options precede `log`; log options follow it. Output is NUL-framed; binary
// numstat `-` becomes null; renames keep the new path. No author, committer or email field is written; name
// trailers and email-like strings are stripped here as well as at upload. `--outside N` (<= 500) adds a second
// bounded `git log` of `<from>` that lists full shas only (the optional `outside_shas` extension).
// Run it on trusted repositories or a fresh clone: git still reads the repository's own configuration.

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { LIMITS } from '../supabase/functions/_shared/core/limits.ts';
import { createRedactionCounts, redactBaseUrl, redactEmails, redactMessage } from '../src/core/gitlog/redact.ts';

const run = promisify(execFile);

/** PLAN §2 #5. */
export const REF_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u{0}-\u{1f}\u{7f}]/u;

export function validateRef(ref: string): string | null {
  if (ref.length === 0 || ref.length > LIMITS.maxRefChars) return `ref must be 1-${LIMITS.maxRefChars} characters`;
  if (CONTROL.test(ref)) return 'ref must not contain control characters';
  if (!REF_PATTERN.test(ref)) return 'ref must be a plain tag, branch, full sha or HEAD (no leading "-", "..", "~", "^", "@{")';
  return null;
}

/** Record separator before each commit, NUL between fields; numstat entries follow, NUL-terminated (-z). */
const FORMAT = '--format=%x1e%H%x00%P%x00%cI%x00%s%x00%b%x00';

export const GLOBAL_ARGS = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false'] as const;

export function buildLogArgs(repo: string, from: string, to: string): string[] {
  return [
    '-C',
    repo,
    ...GLOBAL_ARGS,
    'log',
    '--no-ext-diff',
    '--no-textconv',
    '--no-show-signature',
    '--no-color',
    '--numstat',
    '-z',
    FORMAT,
    '--end-of-options',
    `${from}..${to}`,
  ];
}

export function buildOutsideArgs(repo: string, from: string, count: number): string[] {
  return ['-C', repo, ...GLOBAL_ARGS, 'log', '--no-show-signature', '--no-color', `--max-count=${count}`, '--format=%H', '--end-of-options', from];
}

export interface ExportedCommit {
  sha: string;
  parents: string[];
  date: string;
  subject: string;
  body: string;
  files: { path: string; added: number | null; deleted: number | null }[];
}

export interface FrameResult {
  commits: ExportedCommit[];
  /** Frames that could not be read (index in output order); reported, never guessed. */
  malformed: number[];
}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

/** Parses `git log` output produced with buildLogArgs. Pure; exported for tests. */
export function parseLogOutput(stdout: string): FrameResult {
  const commits: ExportedCommit[] = [];
  const malformed: number[] = [];
  const tokens = stdout.split('\0');
  let cursor = 0;
  let index = 0;
  while (cursor < tokens.length) {
    const start = (tokens[cursor] as string).replace(/^\n+/, '');
    if (start === '') {
      cursor++;
      continue;
    }
    // A record marker is meaningful only between numstat entries. Read the five NUL-framed metadata
    // fields together, so an RS anywhere in a subject or body stays ordinary message text.
    const [parentText, date, subject, body] = tokens.slice(cursor + 1, cursor + 5);
    if (!start.startsWith('\u{1e}') || cursor + 5 >= tokens.length || parentText === undefined || date === undefined || subject === undefined || body === undefined) {
      malformed.push(index);
      break;
    }
    const sha = start.slice(1);
    cursor += 5;
    const parents = parentText.trim() === '' ? [] : parentText.trim().split(' ');
    const files: ExportedCommit['files'] = [];
    let ok = FULL_SHA.test(sha) && parents.every((p) => FULL_SHA.test(p));
    while (cursor < tokens.length) {
      const token = (tokens[cursor] as string).replace(/^\n+/, '');
      if (token.startsWith('\u{1e}')) break;
      const terminated = cursor < tokens.length - 1;
      cursor++;
      if (token === '') continue;
      const m = NUMSTAT.exec(token);
      if (m === null || !terminated) {
        ok = false;
        continue;
      }
      let path = m[3] as string;
      if (path === '') {
        // Rename or copy: "added\tdeleted\t" NUL old-path NUL new-path.
        // Both paths are opaque NUL fields, even when they begin with an RS followed by a full sha.
        const oldPath = tokens[cursor];
        const newPath = tokens[cursor + 1];
        if (cursor + 1 >= tokens.length - 1 || oldPath === undefined || newPath === undefined || newPath === '') {
          ok = false;
          cursor = tokens.length;
          break;
        }
        path = newPath;
        cursor += 2;
      }
      files.push({ path, added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) });
    }
    if (ok) commits.push({ sha, parents, date, subject, body: body.replace(/\n+$/, ''), files });
    else malformed.push(index);
    index++;
  }
  return { commits, malformed };
}

interface Options {
  repo: string;
  from: string;
  to: string;
  out: string | null;
  label: string;
  baseUrl: string | null;
  outside: number;
}

function parseArgs(argv: readonly string[]): Options | string {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    if (!['--repo', '--from', '--to', '--out', '--label', '--base-url', '--outside'].includes(flag)) return `unknown option ${flag}`;
    if (value === undefined) return `missing value for ${flag}`;
    values.set(flag, value);
  }
  const repo = values.get('--repo');
  const from = values.get('--from');
  const to = values.get('--to');
  if (repo === undefined || from === undefined || to === undefined) return 'usage: --repo <dir> --from <ref> --to <ref>';
  for (const ref of [from, to]) {
    const problem = validateRef(ref);
    if (problem !== null) return `${JSON.stringify(ref)}: ${problem}`;
  }
  const outside = Number(values.get('--outside') ?? '0');
  if (!Number.isInteger(outside) || outside < 0 || outside > LIMITS.maxOutsideShas) return `--outside must be 0-${LIMITS.maxOutsideShas}`;
  return {
    repo,
    from,
    to,
    out: values.get('--out') ?? null,
    label: values.get('--label') ?? 'local repository',
    baseUrl: values.get('--base-url') ?? null,
    outside,
  };
}

async function main(argv: readonly string[]): Promise<number> {
  process.stderr.write('Note: run this only on trusted repositories or a fresh clone; git reads the repository configuration.\n');
  const options = parseArgs(argv);
  if (typeof options === 'string') {
    process.stderr.write(`${options}\n`);
    return 2;
  }
  const env = { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  const maxBuffer = 64 * 1024 * 1024;
  const log = await run('git', buildLogArgs(options.repo, options.from, options.to), { env, maxBuffer, encoding: 'utf8' });
  const { commits, malformed } = parseLogOutput(log.stdout);
  if (malformed.length > 0) process.stderr.write(`${malformed.length} malformed frame(s) skipped.\n`);

  let outsideShas: string[] = [];
  if (options.outside > 0) {
    const out = await run('git', buildOutsideArgs(options.repo, options.from, options.outside), { env, maxBuffer, encoding: 'utf8' });
    const inRange = new Set(commits.map((c) => c.sha));
    outsideShas = out.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => FULL_SHA.test(line) && !inRange.has(line));
  }

  const counts = createRedactionCounts();
  const baseUrl = options.baseUrl === null ? null : redactBaseUrl(options.baseUrl, counts);
  const doc = {
    schema: 'gitlog.v1',
    repo_label: redactEmails(options.label, counts),
    from_ref: options.from,
    to_ref: options.to,
    ...(baseUrl === null ? {} : { base_url: baseUrl }),
    commits: commits.map((c) => ({
      sha: c.sha,
      parents: c.parents,
      date: c.date,
      subject: redactEmails(c.subject, counts),
      body: redactMessage(c.body, counts),
      files: c.files.map((f) => ({ path: redactEmails(f.path, counts), added: f.added, deleted: f.deleted })),
    })),
    ...(outsideShas.length > 0 ? { outside_shas: outsideShas } : {}),
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (commits.length > LIMITS.maxCommits) process.stderr.write(`Warning: ${commits.length} commits exceeds the app limit of ${LIMITS.maxCommits}.\n`);
  if (new TextEncoder().encode(text).length > LIMITS.maxFileBytes) process.stderr.write('Warning: output exceeds the 5 MB upload limit.\n');
  process.stderr.write(`Exported ${commits.length} commit(s); removed ${counts.email} email-like string(s), ${counts.name_trailer} name trailer line(s).\n`);
  if (options.out === null) process.stdout.write(text);
  else writeFileSync(options.out, text, 'utf8');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`git log failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}\n`);
      process.exit(1);
    },
  );
}
