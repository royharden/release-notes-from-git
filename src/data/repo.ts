import type { WireUnit } from '@shared/units-wire.ts';
import type { BulletViolation, OutsideRequestDrop } from '@shared/output-schema.ts';
import type { TokenUsage } from '@shared/providers/types.ts';
import type { ParseReport } from '../core/gitlog/schema.ts';
import type { ReviewState, Ruling } from '../core/rulings/types.ts';

export interface CreateRun {
  repo_label: string;
  from_ref: string;
  to_ref: string;
  input_sha256: string;
  config_version: string;
  parse_report: ParseReport;
  has_unit_omissions: boolean;
}
export interface RunRecord extends CreateRun {
  id: string;
  owner: string;
  status: 'draft' | 'sealed';
  omissions_ack_at: string | null;
  revision_sha256: string | null;
  chunk_count: number;
  units: WireUnit[];
  initial_review: ReviewState | null;
  request_drops: RequestDrop[];
  violations: BulletViolation[];
}
/** Immutable generation provenance, also needed when a live run is reloaded. */
export interface RequestDrop extends OutsideRequestDrop { requestShas: string[]; chunk_index: number }
export interface LedgerRow {
  id: string;
  chunk_index: number;
  provider: 'mock' | 'anthropic' | 'openai_compatible';
  model_id: string;
  prompt_hash: string;
  usage: TokenUsage | null;
  price_as_of: string | null;
  reserved_usd: number;
  actual_usd: number;
  latency_ms: number;
  status: string;
}
/** Storage boundary: async throughout so the live adapter can replace the demo repository. */
export interface RunRepository {
  createRun(input: CreateRun): Promise<RunRecord>;
  insertUnits(runId: string, units: readonly WireUnit[]): Promise<void>;
  acknowledgeOmissions(runId: string): Promise<void>;
  sealRun(runId: string): Promise<RunRecord>;
  saveBullets(runId: string, initial: ReviewState, drops: readonly RequestDrop[], violations: readonly BulletViolation[]): Promise<void>;
  appendRuling(runId: string, ruling: Ruling): Promise<void>;
  listRulings(runId: string): Promise<Ruling[]>;
  listLedger(runId: string): Promise<LedgerRow[]>;
  getRun(runId: string): Promise<RunRecord>;
}
