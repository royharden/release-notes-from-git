// Export gate. Re-runs the injected validator on every live bullet (stored verdicts are caches, not authority),
// refuses export when a bullet that would otherwise be exported (stored as kept, or human-attested) now fails a
// hard reason, then requires the latest approve ruling's hash to equal the hash of the payload being exported.

import { LIMITS, codePointLength } from '../../../supabase/functions/_shared/core/limits.ts';
import { isLive } from '../rulings/types.ts';
import type { ReviewBullet, ReviewState } from '../rulings/types.ts';
import { baseUrlProblem, containsEmail } from '../gitlog/redact.ts';
import { isHardReason } from '../validate/reasons.ts';
import type { ValidateFn, Verdict } from '../validate/reasons.ts';
import { buildApprovalPayload, computeApprovalHash } from './approval-hash.ts';
import type { ApprovalPayload } from './approval-hash.ts';
import { renderDroppedJson, renderReleaseNotesJson } from './json.ts';
import type { DroppedEntry, ExportMeta } from './json.ts';
import { renderMarkdown } from './markdown.ts';
import type { ExportCounts, ExportDocument, ExportedBullet } from './markdown.ts';

export type RefusalCode = 'bad_meta' | 'validator_mismatch' | 'hard_reason' | 'not_approved' | 'approval_mismatch';

export interface ExportRefusal {
  ok: false;
  code: RefusalCode;
  detail: string;
  /** Bullet keys the refusal is about (hard_reason, validator_mismatch). */
  keys: string[];
}

export interface PreparedExport {
  ok: true;
  payload: ApprovalPayload;
  document: ExportDocument;
  dropped: DroppedEntry[];
}

export interface ExportFiles {
  ok: true;
  approvalHash: string;
  markdown: string;
  releaseNotesJson: string;
  droppedJson: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Builds the payload and documents from fresh verdicts; no approval check. Used by the UI to compute the hash to approve. */
export function prepareExport(state: ReviewState, meta: ExportMeta, validate: ValidateFn): PreparedExport | ExportRefusal {
  const metaProblem = checkMeta(meta);
  if (metaProblem !== null) return refuse('bad_meta', metaProblem);

  const live = state.bullets.filter(isLive);
  const verdicts = validate(live.map((b) => ({ text: b.text, category: b.category, cites: b.cites, key: b.key })));
  if (verdicts.length !== live.length) {
    return refuse('validator_mismatch', `validator returned ${verdicts.length} verdicts for ${live.length} bullets`);
  }
  const fresh = new Map<ReviewBullet, Verdict>();
  const inconsistent: string[] = [];
  live.forEach((bullet, i) => {
    const verdict = verdicts[i] as Verdict;
    if (verdict.kept !== (verdict.reason === null)) inconsistent.push(bullet.key);
    fresh.set(bullet, verdict);
  });
  if (inconsistent.length > 0) return refuse('validator_mismatch', 'verdict kept/reason disagree', inconsistent);

  const exported: ExportedBullet[] = [];
  const blocked: string[] = [];
  for (const bullet of live) {
    const verdict = fresh.get(bullet) as Verdict;
    const attested = bullet.attestation === 'human_attested';
    if (verdict.reason !== null && isHardReason(verdict.reason)) {
      // A hard failure is a refusal only for a bullet that would otherwise reach the export.
      if (bullet.verdict.kept || attested) blocked.push(bullet.key);
      continue;
    }
    if (!verdict.kept && !attested) continue;
    const cites = [...new Set(verdict.evidence.activeShas)].sort();
    if (cites.length === 0) {
      blocked.push(bullet.key);
      continue;
    }
    exported.push({ key: bullet.key, text: bullet.text, category: bullet.category, cites, attestation: bullet.attestation, origin: bullet.origin });
  }
  if (blocked.length > 0) {
    return refuse('hard_reason', `${blocked.length} bullet(s) fail a citation check; repair citations first`, blocked);
  }

  const counts = countsFor(state, fresh, exported);
  const removed = state.bullets.filter((b) => b.removed).map((b) => b.key);
  const edits = state.bullets.flatMap((b) => (b.superseded_by === null ? [] : [{ from: b.key, to: b.superseded_by }]));
  const payload = buildApprovalPayload({ exported, removed, edits, counts, meta });
  const document: ExportDocument = { version: meta.version, date: meta.date, base_url: meta.base_url, bullets: exported, counts };
  const exportedKeys = new Set(exported.map((b) => b.key));
  const dropped = droppedEntries(state, fresh, exportedKeys);
  return { ok: true, payload, document, dropped };
}

/** The approval hash for the current state and meta, or the refusal that prevents approving it. */
export async function currentApprovalHash(
  state: ReviewState,
  meta: ExportMeta,
  validate: ValidateFn,
): Promise<{ ok: true; hash: string; prepared: PreparedExport } | ExportRefusal> {
  const prepared = prepareExport(state, meta, validate);
  if (!prepared.ok) return prepared;
  return { ok: true, hash: await computeApprovalHash(prepared.payload), prepared };
}

/** exportApproved(state, meta) with the validator injected: the three files, or a refusal. */
export async function exportApproved(state: ReviewState, meta: ExportMeta, validate: ValidateFn): Promise<ExportFiles | ExportRefusal> {
  const current = await currentApprovalHash(state, meta, validate);
  if (!current.ok) return current;
  if (state.latestApproval === null) return refuse('not_approved', 'no approve ruling exists for this run');
  if (state.latestApproval.approval_hash !== current.hash) {
    return refuse('approval_mismatch', 'the content changed after approval; approve again');
  }
  const { document, dropped } = current.prepared;
  return {
    ok: true,
    approvalHash: current.hash,
    markdown: renderMarkdown(document),
    releaseNotesJson: renderReleaseNotesJson(document, meta, current.hash),
    droppedJson: renderDroppedJson(dropped, meta, current.hash),
  };
}

/** Validator counts use the fresh verdict of each live bullet; a bullet no longer live keeps its stored verdict. */
function countsFor(
  state: ReviewState,
  fresh: ReadonlyMap<ReviewBullet, Verdict>,
  exported: readonly ExportedBullet[],
): ExportCounts {
  const generated = state.bullets.filter((b) => b.origin === 'model');
  const validatorKept = generated.filter((b) => (fresh.get(b) ?? b.verdict).kept).length;
  return {
    generated: generated.length,
    validator_kept: validatorKept,
    validator_dropped: generated.length - validatorKept,
    human_removed: state.bullets.filter((b) => b.removed).length,
    human_restored: exported.filter((b) => b.attestation === 'human_attested').length,
    // Only human-added bullets that reach the export: an added literal the validator drops is not counted.
    human_added: exported.filter((b) => b.origin === 'human_add').length,
  };
}

function droppedEntries(state: ReviewState, fresh: ReadonlyMap<ReviewBullet, Verdict>, exportedKeys: ReadonlySet<string>): DroppedEntry[] {
  const entries: DroppedEntry[] = [];
  for (const bullet of state.bullets) {
    const freshVerdict = fresh.get(bullet);
    const verdict = freshVerdict ?? bullet.verdict;
    let disposition: DroppedEntry['disposition'];
    if (freshVerdict !== undefined) {
      if (verdict.kept) continue;
      disposition = exportedKeys.has(bullet.key) ? 'restored' : 'dropped';
    } else if (bullet.removed) {
      disposition = 'removed';
    } else {
      if (verdict.kept) continue;
      disposition = 'edited';
    }
    entries.push({
      key: bullet.key,
      text: bullet.text,
      category: bullet.category,
      cites: bullet.cites,
      origin: bullet.origin,
      reason: verdict.reason,
      reasons: verdict.reasons,
      warnings: verdict.warnings,
      evidence: verdict.evidence,
      disposition,
      edited_to: bullet.superseded_by,
      restore_reason: bullet.restore_reason,
    });
  }
  return entries;
}

function checkMeta(meta: ExportMeta): string | null {
  const { version, date, base_url, input_sha256, config_version } = meta;
  if (typeof version !== 'string' || version.trim() === '' || version !== version.trim() || CONTROL.test(version)) {
    return 'version must be non-empty single-line text without surrounding spaces';
  }
  if (codePointLength(version) > LIMITS.maxVersionChars) return `version longer than ${LIMITS.maxVersionChars} chars`;
  if (containsEmail(version)) return 'version must not contain an email address';
  if (typeof date !== 'string' || !ISO_DAY.test(date) || !isCalendarDay(date)) return 'date must be a calendar day YYYY-MM-DD';
  if (base_url !== null && typeof base_url !== 'string') return 'base_url must be text or empty';
  if (base_url !== null) {
    const problem = baseUrlProblem(base_url);
    if (problem === 'credential_url') return 'base_url must not carry credentials';
    if (problem === 'email') return 'base_url must not contain an email address';
  }
  if (!SHA256_HEX.test(input_sha256)) return 'input_sha256 must be a sha256 hex digest';
  if (!SHA256_HEX.test(config_version)) return 'config_version must be a sha256 hex digest';
  return null;
}

function isCalendarDay(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function refuse(code: RefusalCode, detail: string, keys: string[] = []): ExportRefusal {
  return { ok: false, code, detail, keys };
}
