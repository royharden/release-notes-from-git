// `support`: share of a bullet's content tokens found in the cited evidence. Content tokens = tokenize(bullet),
// minus stop words and generic verbs, stemmed, deduplicated. Evidence tokens = tokenize(evidence), stemmed (no
// filtering). score = found / total. Zero content tokens scores 0 and fails: no vacuous pass, no divide by zero.

import { stem } from './stem.ts';
import { isUninformative } from './stopwords.ts';
import { tokenize } from './tokenize.ts';

export interface SupportResult {
  score: number;
  /** Bullet content terms found in the evidence (stemmed keys, first-seen order); also the highlight terms. */
  matched: string[];
  unmatched: string[];
  total: number;
}

/** Stemmed, deduplicated content terms of a bullet. */
export function contentTerms(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokenize(text)) {
    if (isUninformative(token)) continue;
    const key = stem(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Stemmed evidence vocabulary. */
export function evidenceTerms(evidence: string): Set<string> {
  return new Set(tokenize(evidence).map(stem));
}

export function supportScore(text: string, evidence: string | ReadonlySet<string>): SupportResult {
  const vocabulary = typeof evidence === 'string' ? evidenceTerms(evidence) : evidence;
  const terms = contentTerms(text);
  const matched = terms.filter((t) => vocabulary.has(t));
  const unmatched = terms.filter((t) => !vocabulary.has(t));
  return { score: terms.length === 0 ? 0 : matched.length / terms.length, matched, unmatched, total: terms.length };
}

/** Jaccard similarity of two bullets' content-term sets (1 when both are empty). */
export function termJaccard(a: string, b: string): number {
  const x = new Set(contentTerms(a));
  const y = new Set(contentTerms(b));
  if (x.size === 0 && y.size === 0) return 1;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
