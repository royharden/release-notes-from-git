// `cited` (local minimal implementation; concept owner S5): a Pointer names the source a claim cites. S29 uses one
// kind, `commit:<sha>`, where <sha> is a full sha or a prefix of at least LIMITS.minCitePrefix hex chars. An
// unresolved pointer means the claim is unsupported.

import { LIMITS } from '../../../supabase/functions/_shared/core/limits.ts';

export interface CommitPointer {
  kind: 'commit';
  /** Lower-cased hex, full or prefix, as cited. */
  ref: string;
}

export type Pointer = CommitPointer;

const HEX = new RegExp(`^[0-9a-f]{${LIMITS.minCitePrefix},64}$`);

/** `commit:<hex>` or a bare hex cite -> Pointer; null when it is not a well-formed commit pointer. */
export function parsePointer(raw: string): Pointer | null {
  const text = raw.trim().toLowerCase();
  const ref = text.startsWith('commit:') ? text.slice('commit:'.length) : text;
  return HEX.test(ref) ? { kind: 'commit', ref } : null;
}

export function formatPointer(pointer: Pointer): string {
  return `${pointer.kind}:${pointer.ref}`;
}

export function isFullSha(ref: string): boolean {
  return ref.length === 40 || ref.length === 64;
}
