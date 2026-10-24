// Validator configuration read from config/thresholds.json and config/ignore.json, typed. Pure modules take these
// as parameters; this file only supplies the committed defaults. The config version (rulings replay, approval hash)
// is computed from both by rulings/fingerprint.ts.

import thresholdsJson from '../../config/thresholds.json' with { type: 'json' };
import ignoreJson from '../../config/ignore.json' with { type: 'json' };

export interface Thresholds {
  /** Minimum share of bullet content tokens found in the active cited evidence. */
  minSupport: number;
  /** Token Jaccard at or above which two bullets with the same cite set are duplicates. */
  duplicateJaccard: number;
  /** Width of the band below minSupport treated as borderline (reported only; no judge is built). */
  borderlineBand: number;
  /** true until scripts/eval.ts tunes minSupport on the dev split. */
  untuned: boolean;
  tuned_on: string | null;
}

export interface NonProductPaths {
  /** A path starting with one of these is non-product (docs, tests, CI). */
  prefixes: string[];
  /** A path with one of these as a whole directory segment is non-product. */
  segments: string[];
  /** A path ending with one of these is non-product (Markdown, lockfiles, CI files). */
  suffixes: string[];
}

export interface IgnoreConfig {
  /** Conventional types counted as noise. Never applied to untyped (`unknown`) commits. */
  ignoredTypes: string[];
  nonProductPaths: NonProductPaths;
}

export const DEFAULT_THRESHOLDS: Thresholds = thresholdsJson as Thresholds;
export const DEFAULT_IGNORE: IgnoreConfig = ignoreJson as IgnoreConfig;
