// applyRulings(state, rulings, ctx) -> ReviewState (async: keys and fingerprints are WebCrypto sha256).
//
// Rulings are append-only events replayed in (created_at, id) order; a repeated id is applied once. A restore,
// edit or remove applies only when its target_key names a bullet in the state, its fingerprint equals the current
// evidence fingerprint of that bullet's cites, and its config_version equals the current one; an add applies when
// its fingerprint and config version match. Anything else is listed in notReplayed ("not replayed" in Internal):
// regenerated or reworded text, a changed commit, or changed thresholds/ignore list orphan a ruling by design.
// Restore additionally requires a soft drop whose cites all resolve to active in-range commits, and a reason.
// After replay every live bullet's verdict is recomputed with the injected validator.

import type { BulletInput, CiteResolution, ValidateFn, Verdict } from '../validate/reasons.ts';
import { isHardReason } from '../validate/reasons.ts';
import { rulingKey } from './key.ts';
import { isLive } from './types.ts';
import type { BulletOrigin, ReviewBullet, ReviewState, Ruling } from './types.ts';

export interface ReplayContext {
  validate: ValidateFn;
  /** evidenceFingerprint bound to the current facts. */
  fingerprint: (cites: readonly string[]) => Promise<string>;
  /** configVersion() of the current thresholds and ignore list. */
  configVersion: string;
}

/** Ruling key of a bullet: resolved full shas where cites resolve, the cite as written otherwise. */
export function contentKey(bullet: Pick<BulletInput, 'text' | 'cites'>, verdict: Verdict): Promise<string> {
  return rulingKey(bullet.text, keyCites(bullet.cites, verdict.evidence.cites));
}

function keyCites(cites: readonly string[], resolutions: readonly CiteResolution[]): string[] {
  return cites.map((cite, i) => {
    const r = resolutions[i];
    return r !== undefined && r.status === 'resolved' ? r.sha : cite;
  });
}

/** Review bullets for freshly generated (or otherwise new) bullets, validated together. */
export async function toReviewBullets(
  bullets: readonly BulletInput[],
  origin: BulletOrigin,
  validate: ValidateFn,
): Promise<ReviewBullet[]> {
  const verdicts = validate(bullets.map(plain));
  const out: ReviewBullet[] = [];
  for (let i = 0; i < bullets.length; i++) {
    const bullet = bullets[i] as BulletInput;
    const verdict = verdicts[i] as Verdict;
    out.push(newReviewBullet(bullet, await contentKey(bullet, verdict), origin, verdict, null));
  }
  return out;
}

export async function initialReviewState(bullets: readonly BulletInput[], validate: ValidateFn): Promise<ReviewState> {
  return { bullets: await toReviewBullets(bullets, 'model', validate), latestApproval: null, notReplayed: [] };
}

export type RestoreCheck = { ok: true } | { ok: false; why: 'not_dropped' | 'hard_reason' | 'cites_not_active'; label: string };

/** Restore is for soft drops only, and only when every cite resolves to an active in-range commit. */
export function canRestore(verdict: Verdict): RestoreCheck {
  if (verdict.kept || verdict.reason === null) return { ok: false, why: 'not_dropped', label: 'Only dropped bullets can be restored' };
  if (verdict.reasons.some(isHardReason)) return { ok: false, why: 'hard_reason', label: 'Repair citations first' };
  const cites = verdict.evidence.cites;
  if (cites.length === 0 || !cites.every((c) => c.status === 'resolved' && c.active)) {
    return { ok: false, why: 'cites_not_active', label: 'Repair citations first' };
  }
  return { ok: true };
}

export async function applyRulings(state: ReviewState, rulings: readonly Ruling[], ctx: ReplayContext): Promise<ReviewState> {
  const bullets = state.bullets.map((b) => ({ ...b }));
  const notReplayed: Ruling[] = [];
  let latestApproval = state.latestApproval;
  const seen = new Set<string>();
  const ordered = [...rulings].sort((a, b) => compare(a.created_at, b.created_at) || compare(a.id, b.id));

  const freshVerdict = (target: ReviewBullet): Verdict => {
    const live = bullets.filter(isLive);
    const verdicts = ctx.validate(live.map(plain));
    const i = live.indexOf(target);
    return (i >= 0 ? verdicts[i] : undefined) ?? target.verdict;
  };
  const findTarget = (key: string): ReviewBullet | undefined => bullets.find((b) => b.key === key && isLive(b)) ?? bullets.find((b) => b.key === key);

  for (const ruling of ordered) {
    if (seen.has(ruling.id)) continue;
    seen.add(ruling.id);
    if (ruling.action === 'approve') {
      if (ruling.approval_hash !== null) latestApproval = { ruling_id: ruling.id, approval_hash: ruling.approval_hash };
      continue;
    }
    // Persist invalidation in replay too: a no-op edit must not revive an older approval on reload.
    latestApproval = null;
    if (ruling.config_version !== ctx.configVersion) {
      notReplayed.push(ruling);
      continue;
    }
    if (ruling.action === 'add') {
      const content: BulletInput = { text: ruling.payload.text, category: ruling.payload.category, cites: [...ruling.payload.cites] };
      if ((await ctx.fingerprint(content.cites)) !== ruling.fingerprint) {
        notReplayed.push(ruling);
        continue;
      }
      const [verdict] = ctx.validate([content]);
      if (verdict === undefined) {
        notReplayed.push(ruling);
        continue;
      }
      const key = await contentKey(content, verdict);
      if (!bullets.some((b) => b.key === key && isLive(b))) {
        bullets.push(newReviewBullet(content, key, 'human_add', verdict, ruling.payload.source_unit_key));
      }
      continue;
    }

    const target = findTarget(ruling.target_key);
    if (target === undefined || (await ctx.fingerprint(target.cites)) !== ruling.fingerprint) {
      notReplayed.push(ruling);
      continue;
    }
    switch (ruling.action) {
      case 'remove':
        target.removed = true;
        break;
      case 'restore': {
        const reason = ruling.reason?.trim() ?? '';
        if (reason === '' || !isLive(target) || !canRestore(freshVerdict(target)).ok) {
          notReplayed.push(ruling);
          break;
        }
        target.attestation = 'human_attested';
        target.restore_reason = reason;
        break;
      }
      case 'edit': {
        const content: BulletInput = { text: ruling.payload.text, category: ruling.payload.category, cites: [...ruling.payload.cites] };
        const [verdict] = ctx.validate([content]);
        if (verdict === undefined || !isLive(target)) {
          notReplayed.push(ruling);
          break;
        }
        const key = await contentKey(content, verdict);
        // Category is deliberately absent from the content key. A category-only edit still changes review
        // and approval content; keep the same identity without making it supersede itself.
        if (key === target.key) {
          target.text = content.text;
          target.category = content.category;
          target.cites = content.cites;
          target.verdict = verdict;
          target.attestation = 'validator';
          target.restore_reason = null;
          break;
        }
        target.superseded_by = key;
        if (!bullets.some((b) => b.key === key && isLive(b))) {
          bullets.push(newReviewBullet(content, key, 'human_edit', verdict, target.source_unit_key));
        }
        break;
      }
    }
  }

  const live = bullets.filter(isLive);
  const verdicts = ctx.validate(live.map(plain));
  live.forEach((b, i) => {
    const v = verdicts[i];
    if (v !== undefined) b.verdict = v;
  });
  return { bullets, latestApproval, notReplayed };
}

function newReviewBullet(
  content: BulletInput,
  key: string,
  origin: BulletOrigin,
  verdict: Verdict,
  sourceUnitKey: string | null,
): ReviewBullet {
  return {
    key,
    text: content.text,
    category: content.category,
    cites: [...content.cites],
    origin,
    verdict,
    attestation: 'validator',
    restore_reason: null,
    removed: false,
    superseded_by: null,
    source_unit_key: sourceUnitKey,
  };
}

function plain(b: BulletInput): BulletInput {
  return b.key === undefined ? { text: b.text, category: b.category, cites: b.cites } : { text: b.text, category: b.category, cites: b.cites, key: b.key };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
