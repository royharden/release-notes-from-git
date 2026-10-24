// Approval hash = sha256 of the canonical JSON of the export payload (PLAN §3.2): every exported bullet (text,
// category, full cites, attestation, origin) in export order, removed and edited state, footer counts, version,
// date, base_url, input sha256 and validator-config version. Any change to any of them invalidates approval.

import { sha256Canonical } from '../../../supabase/functions/_shared/core/hash.ts';
import type { Category } from '../../../supabase/functions/_shared/core/output-schema.ts';
import type { Attestation, BulletOrigin } from '../rulings/types.ts';
import type { ExportMeta } from './json.ts';
import type { ExportCounts, ExportedBullet } from './markdown.ts';

export const APPROVAL_SCHEMA = 'approval.v1';

export interface ApprovalBullet {
  key: string;
  text: string;
  category: Category;
  cites: string[];
  attestation: Attestation;
  origin: BulletOrigin;
}

export interface ApprovalPayload {
  schema: typeof APPROVAL_SCHEMA;
  bullets: ApprovalBullet[];
  /** Keys of bullets a person removed, sorted. */
  removed: string[];
  /** Edits as {from, to} key pairs, sorted by from then to. */
  edits: { from: string; to: string }[];
  counts: ExportCounts;
  version: string;
  date: string;
  base_url: string | null;
  input_sha256: string;
  config_version: string;
}

export interface ApprovalInput {
  exported: readonly ExportedBullet[];
  removed: readonly string[];
  edits: readonly { from: string; to: string }[];
  counts: ExportCounts;
  meta: ExportMeta;
}

export function buildApprovalPayload(input: ApprovalInput): ApprovalPayload {
  const { meta } = input;
  return {
    schema: APPROVAL_SCHEMA,
    bullets: input.exported.map((b) => ({
      key: b.key,
      text: b.text,
      category: b.category,
      cites: [...b.cites].sort(),
      attestation: b.attestation,
      origin: b.origin,
    })),
    removed: [...input.removed].sort(),
    edits: [...input.edits]
      .map((e) => ({ from: e.from, to: e.to }))
      .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    counts: { ...input.counts },
    version: meta.version,
    date: meta.date,
    base_url: meta.base_url,
    input_sha256: meta.input_sha256,
    config_version: meta.config_version,
  };
}

export function computeApprovalHash(payload: ApprovalPayload): Promise<string> {
  return sha256Canonical(payload);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
