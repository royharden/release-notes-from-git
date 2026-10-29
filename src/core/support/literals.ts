// Literals a bullet must not invent. Each must appear verbatim (after Unicode NFC on both sides; no case folding, no
// URL canonicalisation) in the active cited subject/body/paths. Classes, extracted in this order with each match
// masked so later classes cannot re-match inside it:
//   url        https?://... (trailing sentence punctuation excluded)
//   backtick   `...` span (its inner text is the literal)
//   cve        CVE-YYYY-NNNN...
//   date       YYYY-MM-DD
//   version    v?N.N[.N[.N]] with optional -pre/+build
//   issue      #N
//   flag       --long-flag or -x (not inside a hyphenated word)
//   number     any other number, single digits included, with optional decimals, thousands separators and %
// Numeric classes (date, version, issue, number) must match on number boundaries in the evidence, so `3` is not
// found inside `13` or `1.3`; the others are plain substrings. Number words ("three") are not literals.

export const LITERAL_KINDS = ['url', 'backtick', 'cve', 'date', 'version', 'issue', 'flag', 'number'] as const;
export type LiteralKind = (typeof LITERAL_KINDS)[number];

export interface Literal {
  kind: LiteralKind;
  value: string;
}

const PATTERNS: readonly { kind: LiteralKind; re: RegExp; group?: number }[] = [
  { kind: 'url', re: /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/g },
  { kind: 'backtick', re: /`([^`\n]+)`/g, group: 1 },
  { kind: 'cve', re: /\bCVE-\d{4}-\d{4,}\b/g },
  { kind: 'date', re: /(?<![\p{L}\p{N}.])\d{4}-\d{2}-\d{2}(?![\p{N}])/gu },
  { kind: 'version', re: /(?<![\p{L}\p{N}.])v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.]+)?(?![\p{N}])/gu },
  { kind: 'issue', re: /(?<![\p{L}\p{N}&])#\d+(?!\p{N})/gu },
  { kind: 'flag', re: /(?<![\p{L}\p{N}_-])--?[A-Za-z][A-Za-z0-9-]*(?:=[^\s,;)]+)?/gu },
  { kind: 'number', re: /(?<![\p{L}\p{N}_.])\d+(?:[.,]\d+)*%?(?![\p{L}\p{N}])/gu },
];

const NUMERIC: ReadonlySet<LiteralKind> = new Set(['date', 'version', 'issue', 'number']);

/** Literals in a bullet, in text order, deduplicated by kind+value. */
export function extractLiterals(text: string): Literal[] {
  let work = text.normalize('NFC');
  const found: { at: number; literal: Literal }[] = [];
  for (const { kind, re, group } of PATTERNS) {
    for (const match of work.matchAll(re)) {
      const value = group === undefined ? match[0] : match[group];
      if (value === undefined || value.trim() === '') continue;
      // Version/number: a trailing "." or "," is sentence punctuation, not part of the literal.
      found.push({ at: match.index, literal: { kind, value: NUMERIC.has(kind) ? value.replace(/[.,]+$/, '') : value } });
    }
    work = work.replace(re, (m) => ' '.repeat(m.length));
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: Literal[] = [];
  for (const { literal } of found) {
    const id = `${literal.kind}\n${literal.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(literal);
  }
  return out;
}

/** True when the literal appears verbatim in the evidence text (NFC both sides). */
export function literalInEvidence(literal: Literal, evidence: string): boolean {
  const haystack = evidence.normalize('NFC');
  const needle = literal.value.normalize('NFC');
  if (!NUMERIC.has(literal.kind)) return haystack.includes(needle);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (isNumberBoundary(haystack, at - 1, -1) && isNumberBoundary(haystack, at + needle.length, 1)) return true;
    from = at + 1;
  }
}

/** The character at `i` (and, for a ".", the one beyond it) does not continue a number. */
function isNumberBoundary(text: string, i: number, direction: 1 | -1): boolean {
  if (i < 0 || i >= text.length) return true;
  const c = text[i] as string;
  if (/\p{N}/u.test(c)) return false;
  if (c === '.' || c === ',') {
    const beyond = text[i + direction];
    return beyond === undefined || !/\p{N}/u.test(beyond);
  }
  return true;
}

/** Literals of `text` not found verbatim in `evidence`, as their values. */
export function missingLiterals(text: string, evidence: string): string[] {
  return extractLiterals(text)
    .filter((literal) => !literalInEvidence(literal, evidence))
    .map((literal) => literal.value);
}
