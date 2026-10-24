// Provider seam shared by the in-browser mock (demo) and the edge function (live). Adapters: mock, anthropic,
// openai_compatible. A provider never decides what is exported; its raw output goes through parseModelOutput
// and the validator.

import type { WireUnit } from '../units-wire.ts';

export const PROVIDER_NAMES = ['mock', 'anthropic', 'openai_compatible'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface GenerationRequest {
  units: WireUnit[];
  /** The complete fenced prompt text (system text, schema, unit envelopes). */
  prompt: string;
  /** sha256 hex of the prompt; keys mock recordings and ledger rows. */
  promptHash: string;
  modelId: string;
  maxTokens: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export type GenerationStatus =
  | 'ok'
  | 'timeout' // no response within the deadline; usage unknown, settled at the full bound
  | 'http_error' // provider answered with a non-success status
  | 'network_error' // connection failed or dropped; usage unknown
  | 'replay_miss'; // mock only: no recording for this prompt hash (an explicit error, never empty success)

export interface GenerationResult {
  /** Parsed JSON body the model produced, or null when there is none. Untrusted until parseModelOutput. */
  raw: unknown;
  /** Provider-reported usage; null when unknown. */
  usage: TokenUsage | null;
  latency_ms: number;
  status: GenerationStatus;
  /** Short provider error code or HTTP status, never response text. */
  error?: string;
}

export interface Provider {
  readonly name: ProviderName;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}
