// Words that carry no checkable content in a release-note bullet: English function words, and a generic-verb list
// of words every bullet uses ("add", "fix", "improve"). Bullet tokens matching either list (as written, or after
// stemming) are not counted toward the support score. Evidence tokens are never filtered.

import { stem } from './stem.ts';

export const STOP_WORDS: readonly string[] = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do',
  'does', 'doing', 'down', 'during', 'each', 'either', 'every', 'few', 'for', 'from', 'further', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'if', 'in', 'into', 'is', 'it', 'its',
  'itself', 'just', 'many', 'may', 'me', 'might', 'more', 'most', 'much', 'must', 'my', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'one', 'only', 'or', 'other', 'our', 'ours', 'out', 'over', 'own', 'per', 'same',
  'shall', 'she', 'should', 'since', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'thus', 'to', 'too', 'under', 'until', 'up',
  'upon', 'us', 'very', 'via', 'was', 'we', 'were', 'what', 'when', 'where', 'whether', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'within', 'without', 'would', 'yet', 'you', 'your', 'yours',
];

export const GENERIC_VERBS: readonly string[] = [
  'add', 'adds', 'added', 'adding', 'allow', 'allows', 'allowed', 'change', 'changes', 'changed', 'enable',
  'enables', 'enabled', 'fix', 'fixes', 'fixed', 'fixing', 'implement', 'implements', 'implemented', 'improve',
  'improves', 'improved', 'improvement', 'improvements', 'introduce', 'introduces', 'introduced', 'make', 'makes',
  'made', 'new', 'now', 'provide', 'provides', 'remove', 'removes', 'removed', 'support', 'supports', 'supported',
  'update', 'updates', 'updated', 'use', 'uses', 'used', 'various', 'misc', 'minor', 'several', 'better',
  'release', 'version',
];
// Not listed on purpose: "set", "get", "work" stem-collide with content words (settings -> set, worker -> work).

const RAW = new Set<string>([...STOP_WORDS, ...GENERIC_VERBS]);
const STEMMED = new Set<string>(GENERIC_VERBS.map(stem));

/** True when a lower-cased token carries no checkable content. */
export function isUninformative(token: string): boolean {
  return RAW.has(token) || STEMMED.has(stem(token));
}
