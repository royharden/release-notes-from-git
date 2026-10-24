// Caps shared by the browser, the edge function and the SQL seal. config/limits.json mirrors these values for
// tooling and docs; a unit test asserts the two agree. Character limits count Unicode code points (what SQL
// char_length counts), never UTF-16 code units.

export const LIMITS = {
  /** File-level: byte length of the uploaded text, checked before JSON.parse. "5 MB" read as 5,000,000 bytes. */
  maxFileBytes: 5_000_000,
  /** File-level: more commits than this rejects the file. */
  maxCommits: 2000,
  /** Record-level: a longer commit body rejects that record. */
  maxBodyChars: 4000,
  /** Record-level: more file entries than this rejects that record. */
  maxFilesPerCommit: 200,
  /** File-level: more declared outside shas than this rejects the file. */
  maxOutsideShas: 500,
  maxLabelChars: 200,
  maxRefChars: 200,
  /** More change units than this rejects the run. */
  maxUnits: 400,
  maxUnitsPerChunk: 40,
  maxChunks: 10,
  /** Per chunk, summed promptChars of its units. */
  maxPromptChars: 60_000,
  /** Prompt-only body excerpt; stored evidence keeps the full accepted body. */
  promptBodyExcerptChars: 1500,
  /** Bullets longer than this drop as too_long. */
  maxBulletChars: 240,
  /** A model bullet may merge at most this many units of its request. */
  maxUnitsPerBullet: 5,
  /** Model text longer than this makes the whole output malformed (a sanity bound, not the too_long rule). */
  maxModelTextChars: 2000,
  maxCitesPerBullet: 100,
  /** Shortest accepted sha prefix in a cite. */
  minCitePrefix: 7,
  maxAttemptsPerRequest: 2,
  /** Run-level attempt cap is this factor times chunk_count. */
  maxAttemptsPerChunk: 2,
  defaultBudgetUsd: 0.5,
  maxBudgetUsd: 5,
  maxVersionChars: 64,
} as const;

export type Limits = typeof LIMITS;

/** Number of Unicode code points, equal to `[...s].length` (a lone surrogate counts as one). */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (isPairStart(s, i)) i++;
    n++;
  }
  return n;
}

/** The first `max` code points of `s`, never splitting a surrogate pair. */
export function sliceCodePoints(s: string, max: number): string {
  let n = 0;
  let i = 0;
  while (i < s.length && n < max) {
    i += isPairStart(s, i) ? 2 : 1;
    n++;
  }
  return s.slice(0, i);
}

function isPairStart(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) return false;
  const d = s.charCodeAt(i + 1);
  return d >= 0xdc00 && d <= 0xdfff;
}
