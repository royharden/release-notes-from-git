import { sha256Canonical } from '@shared/hash.ts';
import { LIMITS } from '@shared/limits.ts';
import { promptChars } from '@shared/units-wire.ts';
import type { WireUnit } from '@shared/units-wire.ts';
import type { BulletViolation } from '@shared/output-schema.ts';
import type { ReviewState, Ruling } from '../core/rulings/types.ts';
import type { CreateRun, LedgerRow, RequestDrop, RunRecord, RunRepository } from './repo.ts';

/** Deliberately ephemeral: refresh starts a fresh demo. Never imports a Supabase client. */
export class MemoryRunRepository implements RunRepository {
  private runs = new Map<string, RunRecord>();
  private rulings = new Map<string, Ruling[]>();
  private ledger = new Map<string, LedgerRow[]>();

  async createRun(input: CreateRun): Promise<RunRecord> {
    const row: RunRecord = { ...structuredClone(input), id: crypto.randomUUID(), owner: 'local-demo', status: 'draft', omissions_ack_at: null, revision_sha256: null, chunk_count: 0, units: [], initial_review: null, request_drops: [], violations: [] };
    this.runs.set(row.id, row);
    this.rulings.set(row.id, []);
    this.ledger.set(row.id, []);
    return structuredClone(row);
  }

  async insertUnits(runId: string, units: readonly WireUnit[]): Promise<void> {
    const run = this.draft(runId);
    run.units = structuredClone([...units]);
  }

  async acknowledgeOmissions(runId: string): Promise<void> {
    this.draft(runId).omissions_ack_at = new Date().toISOString();
  }

  async sealRun(runId: string): Promise<RunRecord> {
    const run = this.draft(runId);
    if ((run.parse_report.rejected > 0 || run.has_unit_omissions) && run.omissions_ack_at === null) throw new Error('Acknowledge omitted records and units before generation.');
    if (run.units.length > LIMITS.maxUnits) throw new Error('Too many units.');
    let previous = 0;
    const counts = new Map<number, { count: number; chars: number }>();
    for (const [i, unit] of run.units.entries()) {
      if (unit.ordinal !== i || !Number.isInteger(unit.chunk_index) || unit.chunk_index < 0 || unit.chunk_index > previous + (i === 0 ? 0 : 1) || unit.chunk_index < previous) throw new Error('Invalid unit order or chunk sequence.');
      previous = unit.chunk_index;
      const c = counts.get(previous) ?? { count: 0, chars: 0 };
      c.count++;
      c.chars += promptChars(unit);
      counts.set(previous, c);
    }
    if (counts.size > LIMITS.maxChunks || [...counts.values()].some((c) => c.count > LIMITS.maxUnitsPerChunk || c.chars > LIMITS.maxPromptChars)) throw new Error('Chunk limits exceeded.');
    run.chunk_count = counts.size;
    run.revision_sha256 = await sha256Canonical(run.units);
    run.status = 'sealed';
    return structuredClone(run);
  }

  async saveBullets(runId: string, initial: ReviewState, drops: readonly RequestDrop[], violations: readonly BulletViolation[]): Promise<void> {
    const run = this.read(runId);
    if (run.status !== 'sealed') throw new Error('Seal input before saving generation.');
    run.initial_review = structuredClone(initial);
    run.request_drops = structuredClone([...drops]);
    run.violations = structuredClone([...violations]);
  }

  async appendRuling(runId: string, ruling: Ruling): Promise<void> {
    const run = this.read(runId);
    if (run.status !== 'sealed') throw new Error('Seal input before review.');
    if (ruling.actor !== 'local-demo') throw new Error('Invalid demo actor.');
    const events = this.rulings.get(runId) as Ruling[];
    const existing = events.find((event) => event.id === ruling.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(ruling)) throw new Error('Event id already used.');
      return;
    }
    events.push(structuredClone(ruling));
  }

  /** Demo service owns ledger writes; the live repository will expose ledger reads only. */
  async recordDemoCall(runId: string, row: LedgerRow): Promise<void> {
    this.read(runId);
    (this.ledger.get(runId) as LedgerRow[]).push(structuredClone(row));
  }

  async listRulings(runId: string): Promise<Ruling[]> { this.read(runId); return structuredClone(this.rulings.get(runId) ?? []); }
  async listLedger(runId: string): Promise<LedgerRow[]> { this.read(runId); return structuredClone(this.ledger.get(runId) ?? []); }
  async getRun(runId: string): Promise<RunRecord> { return structuredClone(this.read(runId)); }
  private read(id: string): RunRecord { const run = this.runs.get(id); if (!run) throw new Error('Run not found.'); return run; }
  private draft(id: string): RunRecord { const run = this.read(id); if (run.status !== 'draft') throw new Error('Sealed input is immutable.'); return run; }
}
