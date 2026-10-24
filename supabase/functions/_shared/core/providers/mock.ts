// Mock provider: deterministic replay of recorded outputs (fixtures/recorded/), keyless and offline. A miss is an
// explicit `replay_miss` result, never an empty success.
//
// Lookup requires an exact prompt hash and template version. Fixture/chunk position never substitutes for a
// hash: editing uploaded or fixture evidence must produce a replay miss. Synthetic recordings carry hashes
// prepared from authored prompt snapshots; their application-pipeline parity check is deferred (see docs).
// The file maps are injected (the browser bundles them; tests read them), so this module needs no filesystem.

import { PROMPT_TEMPLATE_VERSION } from '../prompt.ts';
import type { GenerationRequest, GenerationResult, Provider, TokenUsage } from './types.ts';

export interface RecordingEntry {
  /** File name under fixtures/recorded/. */
  file: string;
  fixture: string;
  chunk_index: number;
  prompt_template_version: string;
  /** sha256 hex of the prompt when verified; the string "unverified" otherwise. */
  prompt_hash: string;
  hash_verified: boolean;
  /** "synthetic-authored" until a live recording replaces it. */
  provenance: 'synthetic-authored' | 'live';
}

export interface RecordingIndex {
  schema: 'recorded-index.v1';
  recordings: RecordingEntry[];
}

export interface RecordingFile {
  schema: 'recording.v1';
  /** Exactly what the model returned (or, for synthetic-authored files, what it is written to return). */
  output: unknown;
  usage: TokenUsage | null;
}

export interface MockOptions {
  index: RecordingIndex;
  files: Readonly<Record<string, RecordingFile>>;
  /** Optional provenance filter; never enables positional replay. Null also permits hash-matched uploads. */
  fixture: string | null;
}

export function findRecording(req: GenerationRequest, options: MockOptions): RecordingEntry | null {
  return options.index.recordings.find(
    (r) => r.hash_verified && /^[0-9a-f]{64}$/.test(r.prompt_hash) && r.prompt_hash === req.promptHash &&
      r.prompt_template_version === PROMPT_TEMPLATE_VERSION &&
      (options.fixture === null || r.fixture === options.fixture),
  ) ?? null;
}

export function createMockProvider(options: MockOptions): Provider {
  return {
    name: 'mock',
    generate(req: GenerationRequest): Promise<GenerationResult> {
      const entry = findRecording(req, options);
      if (entry === null) return Promise.resolve(miss('no_recording'));
      const file = options.files[entry.file];
      if (file === undefined || file.schema !== 'recording.v1') return Promise.resolve(miss('recording_file_missing'));
      return Promise.resolve({ raw: structuredClone(file.output), usage: file.usage, latency_ms: 0, status: 'ok' });
    },
  };
}

function miss(error: string): GenerationResult {
  return { raw: null, usage: null, latency_ms: 0, status: 'replay_miss', error };
}
