// chunkUnits: proposes chunk_index for each unit (PLAN §2 #9). In ordinal order, at most LIMITS.maxUnitsPerChunk
// units per chunk, and a new chunk starts early when the next unit would push the chunk's summed promptChars over
// LIMITS.maxPromptChars. A unit whose own promptChars exceed the cap is rejected visibly (never sent) and the
// remaining units are renumbered. More than LIMITS.maxChunks chunks refuses the run. seal_run re-verifies all of
// this from the stored text columns; these indices are a proposal, not trusted input.
//
// Every unit, noise included, counts toward a chunk's limits (the seal counts all stored units); the prompt
// builder then leaves noise units out of what the model sees.

import { LIMITS } from '../../../supabase/functions/_shared/core/limits.ts';
import { promptChars } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { WireUnit } from '../../../supabase/functions/_shared/core/units-wire.ts';
import type { UnitDraft } from './units.ts';

export interface OversizedUnit {
  unit_key: string;
  prompt_chars: number;
  limit: number;
}

export type ChunkResult =
  | { ok: true; units: WireUnit[]; chunkCount: number; oversized: OversizedUnit[] }
  | { ok: false; code: 'too_many_chunks'; chunkCount: number; limit: number; oversized: OversizedUnit[] };

export function chunkUnits(drafts: readonly UnitDraft[]): ChunkResult {
  const ordered = [...drafts].sort((a, b) => a.ordinal - b.ordinal);
  const oversized: OversizedUnit[] = [];
  const kept: { draft: UnitDraft; chars: number }[] = [];
  for (const draft of ordered) {
    const chars = promptChars(draft);
    if (chars > LIMITS.maxPromptChars) oversized.push({ unit_key: draft.unit_key, prompt_chars: chars, limit: LIMITS.maxPromptChars });
    else kept.push({ draft, chars });
  }

  const units: WireUnit[] = [];
  let chunk = 0;
  let inChunk = 0;
  let charsInChunk = 0;
  kept.forEach(({ draft, chars }, ordinal) => {
    if (inChunk > 0 && (inChunk >= LIMITS.maxUnitsPerChunk || charsInChunk + chars > LIMITS.maxPromptChars)) {
      chunk++;
      inChunk = 0;
      charsInChunk = 0;
    }
    units.push({ ...draft, ordinal, chunk_index: chunk });
    inChunk++;
    charsInChunk += chars;
  });
  const chunkCount = units.length === 0 ? 0 : chunk + 1;
  if (chunkCount > LIMITS.maxChunks) {
    return { ok: false, code: 'too_many_chunks', chunkCount, limit: LIMITS.maxChunks, oversized };
  }
  return { ok: true, units, chunkCount, oversized };
}

/** The units of one chunk, in ordinal order. */
export function unitsOfChunk(units: readonly WireUnit[], chunkIndex: number): WireUnit[] {
  return units.filter((u) => u.chunk_index === chunkIndex).sort((a, b) => a.ordinal - b.ordinal);
}
