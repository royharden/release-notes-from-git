// Fixed suffix stemmer (plain TypeScript, deterministic, no dictionary). Applied identically to bullet and evidence
// tokens, so it only needs to map inflections of one word to one key, not to produce real words:
// parse/parses/parsed/parsing/parser -> pars, retry/retries/retried -> retri, map/mapped/mapping -> map.

const PLURAL_RULES: readonly [RegExp, string][] = [
  [/sses$/, 'ss'],
  [/ies$/, 'y'],
  [/(x|ch|sh|z)es$/, '$1'],
  [/([^su])s$/, '$1'],
];

/** Derivational and inflectional suffixes; the remaining stem must keep at least `min` characters. */
const SUFFIX_RULES: readonly { suffix: string; replace: string; min: number }[] = [
  { suffix: 'ization', replace: 'ize', min: 3 },
  { suffix: 'isation', replace: 'ize', min: 3 },
  { suffix: 'ational', replace: 'ate', min: 3 },
  { suffix: 'ation', replace: 'ate', min: 3 },
  { suffix: 'ement', replace: '', min: 4 },
  { suffix: 'ment', replace: '', min: 4 },
  { suffix: 'ness', replace: '', min: 3 },
  { suffix: 'ing', replace: '', min: 3 },
  { suffix: 'edly', replace: '', min: 3 },
  { suffix: 'ied', replace: 'y', min: 2 },
  { suffix: 'ed', replace: '', min: 3 },
  { suffix: 'ers', replace: '', min: 3 },
  { suffix: 'er', replace: '', min: 3 },
  { suffix: 'ly', replace: '', min: 3 },
];

const DOUBLED = /([bdfgmnprt])\1$/;

export function stem(token: string): string {
  let word = token.toLowerCase();
  if (word.length <= 3) return word;
  for (const [pattern, replacement] of PLURAL_RULES) {
    if (pattern.test(word)) {
      word = word.replace(pattern, replacement);
      break;
    }
  }
  for (const rule of SUFFIX_RULES) {
    if (word.endsWith(rule.suffix) && word.length - rule.suffix.length >= rule.min) {
      word = word.slice(0, word.length - rule.suffix.length) + rule.replace;
      break;
    }
  }
  if (DOUBLED.test(word)) word = word.slice(0, -1);
  if (word.length > 3 && word.endsWith('e')) word = word.slice(0, -1);
  // retry / retries (-> retry) / retried (-> retry): one key for the y/i alternation.
  if (word.length > 3 && word.endsWith('y')) word = `${word.slice(0, -1)}i`;
  return word;
}
