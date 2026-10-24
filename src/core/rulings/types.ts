// Rulings (append-only review events) and the review state they produce. replay.ts (M2) implements
// applyRulings(state, rulings, ctx) -> ReviewState; export/gate.ts consumes ReviewState.
// Stored ruling rows are owner records, not server attestations.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import type { BulletInput, Verdict } from '../validate/reasons.ts';

export const RULING_ACTIONS = ['restore', 'edit', 'remove', 'add', 'approve'] as const;
export type RulingAction = (typeof RULING_ACTIONS)[number];

export interface BulletContent {
  text: string;
  category: Category;
  cites: string[];
}

interface RulingBase {
  /** Client event UUID (unique per ruling; idempotent retry). */
  id: string;
  /** rulingKey of the bullet acted on; for approve, the approval hash. */
  target_key: string;
  /** sha256 of the cited commits' subject+body+paths when the ruling was made. */
  fingerprint: string;
  /** sha256 of config/thresholds.json + config/ignore.json when the ruling was made. */
  config_version: string;
  /** Set on approve rulings; null otherwise. */
  approval_hash: string | null;
  /** Required for restore; optional otherwise. */
  reason: string | null;
  /** Bound to auth.uid() by trigger in live mode; 'local-demo' in demo mode. */
  actor: string;
  created_at: string;
}

export type Ruling =
  | (RulingBase & { action: 'restore'; payload: Record<string, never> })
  | (RulingBase & { action: 'remove'; payload: Record<string, never> })
  | (RulingBase & { action: 'edit'; payload: BulletContent })
  | (RulingBase & { action: 'add'; payload: BulletContent & { source_unit_key: string } })
  | (RulingBase & { action: 'approve'; payload: { version: string; date: string; base_url: string | null } });

export type BulletOrigin = 'model' | 'human_add' | 'human_edit';
export type Attestation = 'validator' | 'human_attested';

export interface ReviewBullet extends BulletInput {
  /** rulingKey(text, cites): content key, stable across regenerations of identical text and cites. */
  key: string;
  origin: BulletOrigin;
  /** Verdict when the bullet entered review (generation, edit save or add). The export gate recomputes. */
  verdict: Verdict;
  /** human_attested after a restore ruling; marked visibly in every export. */
  attestation: Attestation;
  restore_reason: string | null;
  removed: boolean;
  /** Key of the edited bullet that replaced this one; null while this bullet is current. */
  superseded_by: string | null;
  /** For human_add bullets, the uncovered unit the literal came from. */
  source_unit_key: string | null;
}

export interface ReviewState {
  /** Every bullet in review order, including removed and superseded ones (they feed counts and dropped.json). */
  bullets: ReviewBullet[];
  /** Latest approve ruling, if any. Export requires its hash to equal the current approval hash. */
  latestApproval: { ruling_id: string; approval_hash: string } | null;
  /** Rulings whose key, fingerprint or config version no longer match (listed in Internal as "not replayed"). */
  notReplayed: Ruling[];
}

/** A bullet still in play: neither removed nor replaced by an edit. */
export function isLive(bullet: ReviewBullet): boolean {
  return !bullet.removed && bullet.superseded_by === null;
}
