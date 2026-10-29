// Tokenizer for the support score. Text is NFC-normalised, split on anything that is not a letter or digit
// (so paths, snake_case, kebab-case and dotted names split), camelCase and PascalCase are split at case
// boundaries (`parseHTTPHeader` -> parse, http, header), then lower-cased. Pure-digit tokens and single
// characters are dropped: numbers are checked verbatim as literals, not as support terms.

/** Splits camel/Pascal case: `fooBar` -> `foo Bar`, `HTTPServer` -> `HTTP Server`, `v2Api` -> `v2 Api`. */
function splitCase(word: string): string[] {
  return word
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(' ');
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.normalize('NFC').split(/[^\p{L}\p{N}]+/u)) {
    if (word === '') continue;
    for (const part of splitCase(word)) {
      const token = part.toLowerCase();
      if (token.length < 2 || /^\p{N}+$/u.test(token)) continue;
      out.push(token);
    }
  }
  return out;
}
