import { createMockProvider } from '@shared/providers/mock.ts';
import { buildPrompt, allowedShasForPrompt, promptHash } from '@shared/prompt.ts';
import { parseModelOutput } from '@shared/output-schema.ts';
import type { BulletViolation } from '@shared/output-schema.ts';
import type { WireUnit } from '@shared/units-wire.ts';
import type { BulletInput, ValidateFn } from '../core/validate/reasons.ts';
import { REASON_CODES } from '../core/validate/reasons.ts';
import { unitsOfChunk } from '../core/gitfacts/chunk.ts';
import type { ValidatorContext } from '../core/validate/validate.ts';
import { makeValidator, validateBullet } from '../core/validate/validate.ts';
import { contentKey } from '../core/rulings/replay.ts';
import type { ReviewState, Ruling } from '../core/rulings/types.ts';
import type { LedgerRow, RequestDrop } from '../data/repo.ts';
import { recordingFiles, recordingIndex } from './demo-assets.ts';

export type { RequestDrop } from '../data/repo.ts';
export interface DemoGeneration {
  bullets: BulletInput[];
  requestDrops: RequestDrop[];
  violations: BulletViolation[];
  ledger: LedgerRow[];
}

/** Exact prompt-hash replay only. An upload without a matching recording gets an explicit error. */
export async function generateDemo(units: readonly WireUnit[], fixture: string | null): Promise<DemoGeneration> {
  const provider = createMockProvider({ index: recordingIndex, files: recordingFiles, fixture });
  const out: DemoGeneration = { bullets: [], requestDrops: [], violations: [], ledger: [] };
  const chunks = [...new Set(units.map((unit) => unit.chunk_index))].sort((a, b) => a - b);
  for (const chunk of chunks) {
    const input = unitsOfChunk(units, chunk);
    const prompt = buildPrompt(input);
    const hash = await promptHash(prompt.prompt);
    const generated = await provider.generate({ units: input, prompt: prompt.prompt, promptHash: hash, modelId: 'synthetic-authored', maxTokens: 4096 });
    const ledger: LedgerRow = { id: crypto.randomUUID(), chunk_index: chunk, provider: 'mock', model_id: 'synthetic-authored', prompt_hash: hash, usage: generated.usage, price_as_of: null, reserved_usd: 0, actual_usd: 0, latency_ms: generated.latency_ms, status: generated.status };
    out.ledger.push(ledger);
    if (generated.status !== 'ok') throw new DemoGenerationError('No exact recording matches this input. Load Synthetic traps for the recorded demo; uploaded and changed inputs need an exact recording. No live call was made.', out.ledger);
    const allowed = allowedShasForPrompt(input);
    const parsed = parseModelOutput(generated.raw, allowed);
    if (!parsed.ok) {
      ledger.status = 'upstream_malformed';
      throw new DemoGenerationError(`Recorded output refused: ${parsed.detail}`, out.ledger);
    }
    out.bullets.push(...parsed.bullets, ...parsed.outsideRequest.map((drop) => drop.bullet));
    out.requestDrops.push(...parsed.outsideRequest.map((drop) => ({ ...drop, chunk_index: chunk, requestShas: [...allowed.keys()] })));
    out.violations.push(...parsed.violations);
  }
  return out;
}

export class DemoGenerationError extends Error {
  readonly ledger: LedgerRow[];
  constructor(message: string, ledger: LedgerRow[]) { super(message); this.ledger = ledger; }
}

interface RequestEdit { bullet: BulletInput; requestShas: readonly string[] }

/** Preserve request exclusions during replay/export, including descendants of edited request drops. */
export function makeReviewValidator(ctx: ValidatorContext, drops: readonly RequestDrop[], edits: readonly RequestEdit[] = []): ValidateFn {
  const global = makeValidator(ctx);
  return (bullets) => {
    const restrictions = bullets.map((bullet) => {
      const original = drops.find((d) => requestIdentity(d.bullet) === requestIdentity(bullet));
      const inherited = edits.find((edit) => requestIdentity(edit.bullet) === requestIdentity(bullet));
      const source = original ?? inherited;
      if (!source) return null;
      const verdict = validateBullet(bullet, { ...ctx, requestShas: new Set(source.requestShas) });
      if (!original) return verdict;
      // Preserve parseModelOutput's request-drop disposition even when a phantom has no global match.
      const reasons = REASON_CODES.filter((reason) => reason === original.reason || (reason !== 'cite_not_found' && verdict.reasons.includes(reason)));
      return { ...verdict, kept: false, reason: reasons[0] ?? original.reason, reasons, evidence: { ...verdict.evidence, notes: [...verdict.evidence.notes, original.evidence] } };
    });
    // Refused request output must not seed global duplicate detection for otherwise valid output.
    const verdicts = global(bullets.filter((_bullet, i) => restrictions[i] === null || restrictions[i]?.kept));
    let acceptedIndex = 0;
    return bullets.map((_bullet, i) => {
      const restricted = restrictions[i];
      return restricted && !restricted.kept ? restricted : verdicts[acceptedIndex++]!;
    });
  };
}

/** Rebuild immutable request lineage from the complete append-only event list, never from mutable UI state. */
export async function validatorForRulings(ctx: ValidatorContext, drops: readonly RequestDrop[], initial: ReviewState, rulings: readonly Ruling[]): Promise<ValidateFn> {
  const lineage = new Map<string, readonly string[]>();
  const edits: RequestEdit[] = [];
  for (const original of drops) {
    for (const bullet of initial.bullets) if (requestIdentity(bullet) === requestIdentity(original.bullet)) lineage.set(bullet.key, original.requestShas);
  }
  const ordered = [...rulings].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const ruling of ordered) {
    if (ruling.action !== 'edit') continue;
    const requestShas = lineage.get(ruling.target_key);
    if (!requestShas) continue;
    const bullet = ruling.payload;
    const verdict = validateBullet(bullet, { ...ctx, requestShas: new Set(requestShas) });
    lineage.set(await contentKey(bullet, verdict), requestShas);
    edits.push({ bullet, requestShas });
  }
  return makeReviewValidator(ctx, drops, edits);
}

function requestIdentity(bullet: BulletInput): string { return JSON.stringify([bullet.text.normalize('NFC'), [...bullet.cites].sort()]); }
