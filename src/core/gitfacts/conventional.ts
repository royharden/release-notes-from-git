// Conventional-commit fields: type, scope, `!` and the `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer.
// A subject without a recognised `type(scope)!: ` prefix is untyped (UNKNOWN_TYPE); the ignore list never
// applies to it (spec review B1).

import { UNKNOWN_TYPE } from '../../../supabase/functions/_shared/core/units-wire.ts';

/**
 * Types recognised as conventional. A colon prefix outside this list ("Note: ...", "WIP: ...") is not a type,
 * so prose subjects stay untyped instead of inventing a type.
 */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'docs',
  'style',
  'test',
  'build',
  'ci',
  'chore',
  'deps',
] as const;

const TYPE_SET: ReadonlySet<string> = new Set(CONVENTIONAL_TYPES);

/** `type(scope)!: description`, type case-insensitive, scope without parentheses or line breaks. */
const HEADER = /^([A-Za-z]+)(?:\(([^()\r\n]*)\))?(!)?: (.*)$/;

/** Footer token at the start of a body line, per the Conventional Commits spec (upper case, space or hyphen). */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: \S/m;

export interface ConventionalFields {
  /** Lower-cased conventional type, or UNKNOWN_TYPE. */
  type: string;
  scope: string | null;
  /** `!` before the colon. */
  bang: boolean;
  /** A `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer line in the body. */
  breakingFooter: boolean;
  /** Subject text after the prefix (the whole subject when untyped). */
  description: string;
}

export function parseConventional(subject: string, body: string): ConventionalFields {
  const breakingFooter = BREAKING_FOOTER.test(body);
  const match = HEADER.exec(subject.trim());
  const type = match?.[1]?.toLowerCase();
  if (!match || type === undefined || !TYPE_SET.has(type)) {
    return { type: UNKNOWN_TYPE, scope: null, bang: false, breakingFooter, description: subject.trim() };
  }
  const scope = match[2]?.trim();
  return {
    type,
    scope: scope === undefined || scope === '' ? null : scope,
    bang: match[3] === '!',
    breakingFooter,
    description: (match[4] ?? '').trim(),
  };
}

export function isTyped(fields: Pick<ConventionalFields, 'type'>): boolean {
  return fields.type !== UNKNOWN_TYPE;
}

/** A breaking marker: `!` or a breaking footer. The only evidence `category_unsupported` accepts for `breaking`. */
export function isBreaking(fields: Pick<ConventionalFields, 'bang' | 'breakingFooter'>): boolean {
  return fields.bang || fields.breakingFooter;
}
