// Ruling key = sha256(normalised text + "\n" + sorted full cites joined by ","). Normalisation: Unicode NFC,
// lower case, whitespace runs collapsed to one space, trimmed. Callers pass resolved full shas when the cites
// resolve, else the cites as written (lower-cased here), so unresolvable bullets still get a stable key.

import { sha256Hex } from '../../../supabase/functions/_shared/core/hash.ts';

export function normaliseText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normaliseCites(cites: readonly string[]): string[] {
  return [...new Set(cites.map((cite) => cite.trim().toLowerCase()))].sort();
}

export function rulingKeyInput(text: string, cites: readonly string[]): string {
  return `${normaliseText(text)}\n${normaliseCites(cites).join(',')}`;
}

export function rulingKey(text: string, cites: readonly string[]): Promise<string> {
  return sha256Hex(rulingKeyInput(text, cites));
}
