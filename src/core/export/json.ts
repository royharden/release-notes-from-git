// release-notes.json (full shas, attestation per bullet) and dropped.json (every drop with reason, evidence and
// later disposition). Both are browser downloads only.

import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import type { BulletOrigin } from '../rulings/types.ts';
import type { Evidence, ReasonCode, WarningCode } from '../validate/reasons.ts';
import { sectionOf } from './markdown.ts';
import type { ExportDocument } from './markdown.ts';

export interface ExportMeta {
  version: string;
  /** YYYY-MM-DD, user input. */
  date: string;
  base_url: string | null;
  /** sha256 of the sanitised fact table. */
  input_sha256: string;
  /** sha256 of config/thresholds.json + config/ignore.json. */
  config_version: string;
}

export type DroppedDisposition = 'dropped' | 'restored' | 'removed' | 'edited';

export interface DroppedEntry {
  key: string;
  text: string;
  category: Category;
  /** Cites as written. */
  cites: string[];
  origin: BulletOrigin;
  /** Validator reason; null for a kept bullet a person removed. */
  reason: ReasonCode | null;
  reasons: ReasonCode[];
  warnings: WarningCode[];
  evidence: Evidence;
  disposition: DroppedDisposition;
  /** Key of the replacing bullet when disposition is "edited". */
  edited_to: string | null;
  restore_reason: string | null;
}

export function renderReleaseNotesJson(doc: ExportDocument, meta: ExportMeta, approvalHash: string): string {
  const body = {
    schema: 'release-notes.v1',
    version: doc.version,
    date: doc.date,
    base_url: doc.base_url,
    input_sha256: meta.input_sha256,
    config_version: meta.config_version,
    approval_hash: approvalHash,
    claim: 'Each bullet is traceable to the cited commit messages and paths; this does not prove the commit text is true.',
    counts: doc.counts,
    bullets: doc.bullets.map((b) => ({
      text: b.text,
      category: b.category,
      section: sectionOf(b.category),
      cites: b.cites,
      attestation: b.attestation,
      origin: b.origin,
    })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function renderDroppedJson(entries: readonly DroppedEntry[], meta: ExportMeta, approvalHash: string): string {
  const body = {
    schema: 'dropped.v1',
    input_sha256: meta.input_sha256,
    config_version: meta.config_version,
    approval_hash: approvalHash,
    dropped: entries,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
