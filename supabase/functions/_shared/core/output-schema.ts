// Hand-written validator for the generator's output. The only fields a model may produce are
// {bullets:[{text, category, cites}]}; anything else (version, date, heading, url, ...) makes the output malformed.
// Run by the edge function before accepting output (malformed -> 502 upstream_malformed) and by the demo path.

import { LIMITS, codePointLength } from './limits.ts';
import type { WireUnit } from './units-wire.ts';

export const CATEGORIES = ['breaking', 'feature', 'fix', 'performance', 'security', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export interface ModelBullet {
  text: string;
  category: Category;
  /** Lower-cased sha or sha prefix (>= minCitePrefix hex chars), as the model wrote it. May be empty (no_citation). */
  cites: string[];
}

export const MODEL_OUTPUT_FIELDS = ['bullets'] as const;
export const MODEL_BULLET_FIELDS = ['text', 'category', 'cites'] as const satisfies readonly (keyof ModelBullet)[];

const HEX_CITE = new RegExp(`^[0-9a-f]{${LIMITS.minCitePrefix},64}$`);

/** Full sha -> unit_key for every commit of the request's units: the per-request allowed sha set. */
export type AllowedShas = ReadonlyMap<string, string>;

export function allowedShasFromUnits(units: readonly Pick<WireUnit, 'unit_key' | 'shas'>[]): AllowedShas {
  const allowed = new Map<string, string>();
  for (const unit of units) for (const sha of unit.shas) allowed.set(sha, unit.unit_key);
  return allowed;
}

/** A bullet removed before validation; listed for the Internal view, never exported. */
export interface BulletViolation {
  index: number;
  code: 'non_hex_cite' | 'too_many_units';
  detail: string;
}

/** A bullet citing a sha outside this request's input; it drops as cite_out_of_range. */
export interface OutsideRequestDrop {
  index: number;
  bullet: ModelBullet;
  reason: 'cite_out_of_range';
  evidence: 'not in request input';
  outside: string[];
}

export type ParsedModelOutput =
  | { ok: true; bullets: ModelBullet[]; outsideRequest: OutsideRequestDrop[]; violations: BulletViolation[] }
  | { ok: false; error: 'upstream_malformed'; detail: string };

/**
 * Validate raw model output against the schema and the per-request allowed-sha rule.
 * Whole-output faults (wrong shape, extra or missing fields, wrong types, unknown category, more bullets than
 * request units) return ok:false. Per-bullet faults remove only that bullet: a non-hex cite or a bullet whose
 * cites reach more than maxUnitsPerBullet request units becomes a violation; a cite that matches no allowed
 * sha (exactly or as a prefix) moves the bullet to outsideRequest. A prefix matching several allowed shas is
 * left for the validator (cite_ambiguous).
 */
export function parseModelOutput(json: unknown, allowed: AllowedShas): ParsedModelOutput {
  const malformed = (detail: string): ParsedModelOutput => ({ ok: false, error: 'upstream_malformed', detail });
  if (!isPlainRecord(json)) return malformed('output is not an object');
  const extraTop = Object.keys(json).filter((key) => !(MODEL_OUTPUT_FIELDS as readonly string[]).includes(key));
  if (extraTop.length > 0) return malformed(`unexpected top-level field(s): ${extraTop.join(', ')}`);
  const rawBullets = json.bullets;
  if (!Array.isArray(rawBullets)) return malformed('bullets is not an array');
  // Deliberate: the generator's role is one sentence per unit or skip (merging only reduces the count), so more
  // bullets than request units means the output ignored its contract; the whole chunk is refused rather than
  // trimmed. Documented in docs/LIMITATIONS.md.
  const unitCount = new Set(allowed.values()).size;
  if (rawBullets.length > unitCount) return malformed(`${rawBullets.length} bullets for ${unitCount} units`);

  const bullets: ModelBullet[] = [];
  const outsideRequest: OutsideRequestDrop[] = [];
  const violations: BulletViolation[] = [];
  for (let index = 0; index < rawBullets.length; index++) {
    const shaped = shapeBullet(rawBullets[index]);
    if (typeof shaped === 'string') return malformed(`bullet ${index}: ${shaped}`);
    const bullet = shaped;
    const nonHex = bullet.cites.filter((cite) => !HEX_CITE.test(cite));
    if (nonHex.length > 0) {
      violations.push({ index, code: 'non_hex_cite', detail: `${nonHex.length} cite(s) are not ${LIMITS.minCitePrefix}-64 hex chars` });
      continue;
    }
    const outside: string[] = [];
    const units = new Set<string>();
    for (const cite of bullet.cites) {
      const matched = matchAllowed(cite, allowed);
      if (matched.length === 0) outside.push(cite);
      // Only a cite that resolves to exactly one sha counts toward the unit limit; an ambiguous prefix is left
      // for the validator (cite_ambiguous) rather than inflating the count into too_many_units.
      else if (matched.length === 1) units.add(matched[0] as string);
    }
    if (outside.length > 0) {
      outsideRequest.push({ index, bullet, reason: 'cite_out_of_range', evidence: 'not in request input', outside });
      continue;
    }
    if (units.size > LIMITS.maxUnitsPerBullet) {
      violations.push({ index, code: 'too_many_units', detail: `cites reach ${units.size} units (max ${LIMITS.maxUnitsPerBullet})` });
      continue;
    }
    bullets.push(bullet);
  }
  return { ok: true, bullets, outsideRequest, violations };
}

/** Returns the bullet, or a description of why the shape is malformed. */
function shapeBullet(raw: unknown): ModelBullet | string {
  if (!isPlainRecord(raw)) return 'not an object';
  const keys = Object.keys(raw);
  const extra = keys.filter((key) => !(MODEL_BULLET_FIELDS as readonly string[]).includes(key));
  if (extra.length > 0) return `unexpected field(s): ${extra.join(', ')}`;
  const { text, category, cites } = raw;
  if (typeof text !== 'string' || text.trim() === '') return 'text must be a non-empty string';
  if (codePointLength(text) > LIMITS.maxModelTextChars) return `text longer than ${LIMITS.maxModelTextChars} chars`;
  if (!isCategory(category)) return 'category is not one of the allowed categories';
  if (!Array.isArray(cites) || !cites.every((cite): cite is string => typeof cite === 'string')) {
    return 'cites must be an array of strings';
  }
  if (cites.length > LIMITS.maxCitesPerBullet) return `more than ${LIMITS.maxCitesPerBullet} cites`;
  return { text, category, cites: cites.map((cite) => cite.trim().toLowerCase()) };
}

/** Unit keys of the allowed shas a cite matches exactly or as a prefix. */
function matchAllowed(cite: string, allowed: AllowedShas): string[] {
  const exact = allowed.get(cite);
  if (exact !== undefined) return [exact];
  const units: string[] = [];
  for (const [sha, unitKey] of allowed) if (sha.startsWith(cite)) units.push(unitKey);
  return units;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
