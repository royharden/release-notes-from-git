// Redaction applied to every retained string at parse time. Claim (honest limit): author fields, named
// trailers and email patterns are removed; names embedded in prose cannot all be detected.

import type { RedactionKind } from './schema.ts';

export type RedactionCounts = Record<RedactionKind, number>;

export function createRedactionCounts(): RedactionCounts {
  return { email: 0, name_trailer: 0, author_field: 0, credential_url: 0 };
}

/**
 * Email-like: local part, "@", one or more dot-terminated domain labels, alphabetic TLD of 2+ letters.
 * The alphabetic TLD keeps package specs such as `lodash@4.17.21` and scopes such as `@types/node` intact.
 * `/` is left out of the local part so a path or ref prefix (`docs/`, `release/`) survives redaction.
 */
const EMAIL_SOURCE = "[A-Za-z0-9.!#$%&'*+=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}";
const EMAIL_GLOBAL = new RegExp(EMAIL_SOURCE, 'g');
const EMAIL_ANY = new RegExp(EMAIL_SOURCE);

export const EMAIL_PLACEHOLDER = '[email removed]';

/**
 * A trailer line that carries a name or email: any `<Token>-by:` (Signed-off-by, Co-authored-by, Reviewed-by,
 * Reported-by, Acked-by, Tested-by, ...), plus Cc/Bcc/Author/Committer lines. Case-insensitive.
 */
const NAME_TRAILER = /^[ \t]*(?:[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-by|cc|bcc|author|committer)[ \t]*:/i;

/** Input keys treated as author data (dropped and counted as author_field). */
const AUTHOR_KEY = /author|committer|email|e-mail|mail|name|signer|signature|login/i;

export function containsEmail(text: string): boolean {
  return EMAIL_ANY.test(text);
}

export function redactEmails(text: string, counts: RedactionCounts): string {
  return text.replace(EMAIL_GLOBAL, () => {
    counts.email++;
    return EMAIL_PLACEHOLDER;
  });
}

/** Drops name-carrying trailer lines. Line endings are normalised to "\n"; trailing blank lines are trimmed. */
export function stripNameTrailers(text: string, counts: RedactionCounts): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (NAME_TRAILER.test(line)) counts.name_trailer++;
    else kept.push(line);
  }
  return kept.join('\n').replace(/\s+$/, '');
}

/** Trailers first (so a trailer's email is counted once, as a trailer), then email patterns. */
export function redactMessage(text: string, counts: RedactionCounts): string {
  return redactEmails(stripNameTrailers(text, counts), counts);
}

export function isAuthorLikeKey(key: string): boolean {
  return AUTHOR_KEY.test(key);
}

/** Why a base_url string must not be retained, or null when it may be kept. */
export function baseUrlProblem(raw: string): 'credential_url' | 'email' | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Unparseable: an address anywhere is an email; any other "@" may be a user-info separator.
    if (containsEmail(raw) || containsEmail(safeDecode(raw))) return 'email';
    return raw.includes('@') ? 'credential_url' : null;
  }
  if (url.username !== '' || url.password !== '') return 'credential_url';
  // An address in the path, query or fragment would otherwise be carried verbatim into the export. The decoded
  // form is checked too, so a percent-encoded "@" (%40) does not hide one.
  return containsEmail(raw) || containsEmail(safeDecode(raw)) ? 'email' : null;
}

/** decodeURIComponent, or the input unchanged when it holds a malformed escape. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * base_url is kept only without credentials or an email address (counted by kind, then discarded). It is not
 * otherwise validated here: the export link rule decides whether it is linkable (https, no credentials, query or
 * fragment).
 */
export function redactBaseUrl(raw: string, counts: RedactionCounts): string | null {
  const problem = baseUrlProblem(raw);
  if (problem === null) return raw;
  counts[problem]++;
  return null;
}
