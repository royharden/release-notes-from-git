import type { TokenUsage } from './providers/types.ts';

export type LiveProviderName = 'anthropic' | 'openai_compatible';
export interface ModelPrice { provider: LiveProviderName; input_usd_per_mtok: number; output_usd_per_mtok: number; as_of: string }
export interface PriceBook { schema: 'prices.v1'; currency?: 'USD'; models: Record<string, ModelPrice> }

/** MODEL_PRICES_JSON is the deployed copy of config/prices.json, not a second source table. */
export function readPrices(text: string | undefined): PriceBook | null {
  if (!text || new TextEncoder().encode(text).byteLength > 65536) return null;
  try {
    const book = JSON.parse(text) as PriceBook;
    if (book.schema !== 'prices.v1' || (book.currency !== undefined && book.currency !== 'USD') || !book.models || Array.isArray(book.models) || typeof book.models !== 'object' || Object.keys(book.models).length > 100) return null;
    for (const [model, price] of Object.entries(book.models)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model) || !price || !['anthropic','openai_compatible'].includes(price.provider)) return null;
      if (![price.input_usd_per_mtok,price.output_usd_per_mtok].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 10000)) return null;
      if (typeof price.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(price.as_of) || new Date(`${price.as_of}T00:00:00Z`).toISOString().slice(0,10) !== price.as_of) return null;
    }
    return book;
  } catch { return null; }
}
export function costUsd(usage: TokenUsage, price: ModelPrice): number {
  // Round upward to a micro-dollar so binary rounding cannot under-reserve.
  return Math.ceil(usage.input_tokens * price.input_usd_per_mtok + usage.output_tokens * price.output_usd_per_mtok) / 1e6;
}
export function reservationUsd(serializedBody: string, maxTokens: number, price: ModelPrice): number {
  return costUsd({ input_tokens: new TextEncoder().encode(serializedBody).byteLength, output_tokens: maxTokens }, price);
}

