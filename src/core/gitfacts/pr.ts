// Pull-request ids and issue references. Only a squash suffix `(#N)` and a GitHub merge subject
// `Merge pull request #N ...` identify a PR; `Fixes/Closes/Resolves #N` are issue references and never group
// commits (several PRs can fix one issue).

/** `(#123)` at the end of a subject (squash merges). */
const SQUASH_PR = /\(#(\d{1,9})\)\s*$/;

/** GitHub merge-commit subject. */
const MERGE_PR = /^Merge pull request #(\d{1,9})\b/;

/** Closing keywords (GitHub's list) followed by `#N`, anywhere in subject or body. */
const ISSUE_REF = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b:?[ \t]+#(\d{1,9})\b/gi;

export function squashPrNumber(subject: string): number | null {
  const match = SQUASH_PR.exec(subject);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function mergePrNumber(subject: string): number | null {
  const match = MERGE_PR.exec(subject.trim());
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Issue numbers referenced by closing keywords, unique, in first-seen order. */
export function issueRefs(subject: string, body: string): number[] {
  const seen = new Set<number>();
  for (const match of `${subject}\n${body}`.matchAll(ISSUE_REF)) {
    if (match[1] !== undefined) seen.add(Number(match[1]));
  }
  return [...seen];
}

/** Subject with a trailing squash `(#N)` removed (for literal-add and baseline text). */
export function stripPrSuffix(subject: string): string {
  return subject.replace(SQUASH_PR, '').trim();
}
