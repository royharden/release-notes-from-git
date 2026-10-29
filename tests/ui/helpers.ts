import type { ReviewBullet } from '../../src/core/rulings/types.ts';
import { emptyEvidence } from '../../src/core/validate/reasons.ts';
import type { ReasonCode, Verdict } from '../../src/core/validate/reasons.ts';
export const SHA = 'a'.repeat(40);
export function verdict(reason: ReasonCode | null = null): Verdict {
  return { kept: reason === null, reason, reasons: reason === null ? [] : [reason], warnings: [], support_score: reason === null ? 1 : 0.1, evidence: { ...emptyEvidence(), activeShas: [SHA], cites: [{ cite: SHA, status: 'resolved', sha: SHA, active: true }], notes: ['Synthetic evidence detail'] } };
}
export function reviewBullet(reason: ReasonCode | null = null, overrides: Partial<ReviewBullet> = {}): ReviewBullet {
  return { text: 'CSV export escapes commas.', category: 'fix', cites: [SHA], key: reason ?? 'kept-key', origin: 'model', verdict: verdict(reason), attestation: 'validator', restore_reason: null, removed: false, superseded_by: null, source_unit_key: null, ...overrides };
}
