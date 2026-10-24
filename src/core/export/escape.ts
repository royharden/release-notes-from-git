// Markdown escaping for commit- and model-derived text. Output must not be able to create headings, block
// quotes, lists, HTML, images, links, autolinks, emphasis, tables, math or code fences in a CommonMark/GFM
// renderer. Links in the export are generated only by markdown.ts from validated shas and base_url.

/** ASCII punctuation escaped with a backslash anywhere in plain text (each is a valid CommonMark escape). */
const INLINE_SPECIALS = /[\\`*_[\]()#!<>|~&$]/g;

/**
 * Text a GFM renderer would autolink: scheme URLs, `www.` hosts (any case) and email-like strings, plus
 * `@handle` / `@org/team` mentions (an "@" not preceded by a word character, followed by one), which GitHub
 * would turn into notifications; a backslash escape does not stop a mention. These are emitted as code spans,
 * which no renderer links, mentions or formats. `pkg@1.2.3` is not a mention, but GFM would autolink it as a
 * mailto: address, so the email branch code-spans it.
 */
const AUTOLINKABLE = /(?:\b[A-Za-z][A-Za-z0-9+.-]*:\/\/|\bwww\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+|(?<!\w)@\w[\w/-]*/gi;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
/** Bidirectional and invisible formatting controls that can make rendered text differ from its source. */
const FORMAT_CHARS = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** One line of plain text: control characters become spaces, format controls are removed, whitespace collapsed. */
export function toSingleLine(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(FORMAT_CHARS, '').replace(/\s+/g, ' ').trim();
}

/** Escape text for inline Markdown, keeping it on one line. */
export function escapeInline(text: string): string {
  const line = toSingleLine(text);
  let out = '';
  let last = 0;
  for (const match of line.matchAll(AUTOLINKABLE)) {
    out += escapePlain(line.slice(last, match.index));
    out += codeSpan(match[0]);
    last = match.index + match[0].length;
  }
  out += escapePlain(line.slice(last));
  return escapeLeadingMarker(out);
}

function escapePlain(text: string): string {
  return text.replace(INLINE_SPECIALS, '\\$&');
}

/**
 * Block markers that are not escaped everywhere: a leading `-`, `+` or `=` (list item, thematic break) and an
 * ordered-list marker `12. ` (`12)` is already escaped because `)` is; `1.4.0` is not a marker and stays as is).
 * `#`, `>`, `*` and backticks are escaped everywhere.
 */
function escapeLeadingMarker(text: string): string {
  if (/^[-+=]/.test(text)) return `\\${text}`;
  return text.replace(/^(\d{1,9})\.(?=\s|$)/, '$1\\.');
}

/** A code span whose fence is longer than any backtick run inside it. */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
