import type { SupabaseClient } from '@supabase/supabase-js';
import type { WireUnit } from '@shared/units-wire.ts';
import type { BulletViolation } from '@shared/output-schema.ts';
import { sha256Canonical } from '@shared/hash.ts';
import type { ReviewState, Ruling } from '../core/rulings/types.ts';
import type { CreateRun, LedgerRow, RequestDrop, RunRecord, RunRepository } from './repo.ts';

function check(error: { message: string } | null): void { if (error) throw new Error(error.message); }

/** All browser reads/writes use the current user's JWT and RLS. There is no privileged browser client. */
export class SupabaseRunRepository implements RunRepository {
  private client: SupabaseClient;
  readonly owner: string;
  constructor(client: SupabaseClient,owner: string) { this.client = client; this.owner = owner; }
  async createRun(input: CreateRun): Promise<RunRecord> {
    const { data,error } = await this.client.from('runs').insert(input).select('id,owner').single(); check(error);
    if (!data || data.owner !== this.owner) throw new Error('Authenticated owner mismatch.');
    return this.getRun(data.id as string);
  }
  async insertUnits(runId: string,units: readonly WireUnit[]): Promise<void> {
    if (!units.length) return;
    const { error } = await this.client.from('run_units').insert(units.map((unit) => ({ ...unit,run_id: runId }))); check(error);
  }
  async acknowledgeOmissions(runId: string): Promise<void> {
    const { data,error } = await this.client.from('runs').update({ omissions_ack_at: new Date().toISOString() }).eq('id',runId).eq('owner',this.owner).select('id'); check(error);
    if (data?.length !== 1) throw new Error('Owned draft was not updated.');
  }
  async sealRun(runId: string): Promise<RunRecord> {
    const { error } = await this.client.rpc('seal_run',{ p_run_id: runId }); check(error); return this.getRun(runId);
  }
  async saveBullets(runId: string,initial: ReviewState,drops: readonly RequestDrop[],violations: readonly BulletViolation[]): Promise<void> {
    const snapshot = { initial_review: initial,request_drops: [...drops],violations: [...violations] };
    const { error } = await this.client.from('bullets').insert({ run_id: runId,...snapshot });
    if (error?.code === '23505') {
      const current = await this.getRun(runId);
      if (await sha256Canonical(snapshot) !== await sha256Canonical({ initial_review: current.initial_review,request_drops: current.request_drops,violations: current.violations })) throw new Error('An immutable generation snapshot already exists for this run.');
    } else check(error);
  }
  async appendRuling(runId: string,ruling: Ruling): Promise<void> {
    if (ruling.actor !== this.owner) throw new Error('Review actor does not match the signed-in owner.');
    const values = { action: ruling.action,target_key: ruling.target_key,payload: ruling.payload,fingerprint: ruling.fingerprint,config_version: ruling.config_version,approval_hash: ruling.approval_hash,reason: ruling.reason,created_at: ruling.created_at };
    const id = ruling.id;
    const { error } = await this.client.from('rulings').insert({ ...values,client_event_id: id,run_id: runId });
    if (error?.code === '23505') {
      const existing = (await this.listRulings(runId)).find((event) => event.id === id);
      if (!existing || await sha256Canonical(existing) !== await sha256Canonical(ruling)) throw new Error('Review event id already belongs to another event.');
    } else check(error);
  }
  async listRulings(runId: string): Promise<Ruling[]> {
    const { data,error } = await this.client.from('rulings').select('*').eq('run_id',runId).eq('owner',this.owner).order('created_at').order('client_event_id'); check(error);
    return (data ?? []).map((row) => ({ id: row.client_event_id,action: row.action,target_key: row.target_key,payload: row.payload,fingerprint: row.fingerprint,config_version: row.config_version,approval_hash: row.approval_hash,reason: row.reason,actor: row.actor,created_at: new Date(row.created_at as string).toISOString() }) as Ruling);
  }
  async listLedger(runId: string): Promise<LedgerRow[]> {
    const { data,error } = await this.client.from('llm_calls').select('*').eq('run_id',runId).eq('owner',this.owner).order('created_at').order('id'); check(error);
    return (data ?? []).map((row) => ({ id: row.id as string,chunk_index: row.chunk_index as number,provider: row.provider as LedgerRow['provider'],model_id: row.model_id as string,prompt_hash: row.prompt_hash as string,usage: row.input_tokens === null || row.output_tokens === null ? null : { input_tokens: Number(row.input_tokens),output_tokens: Number(row.output_tokens) },price_as_of: row.price_as_of as string,reserved_usd: Number(row.reserved_usd),actual_usd: Number(row.cost_usd ?? 0),latency_ms: Number(row.latency_ms ?? 0),status: row.status as string }));
  }
  async getRun(runId: string): Promise<RunRecord> {
    const { data,error } = await this.client.from('runs').select('*').eq('id',runId).eq('owner',this.owner).single(); check(error);
    if (!data || data.owner !== this.owner) throw new Error('Owned run not found.');
    const [unitResult,snapshotResult] = await Promise.all([
      this.client.from('run_units').select('*').eq('run_id',runId).eq('owner',this.owner).order('ordinal'),
      this.client.from('bullets').select('initial_review,request_drops,violations').eq('run_id',runId).eq('owner',this.owner).maybeSingle(),
    ]);
    check(unitResult.error); check(snapshotResult.error);
    return { ...data,units: (unitResult.data ?? []).map((row) => ({ ordinal: row.ordinal,chunk_index: row.chunk_index,unit_key: row.unit_key,shas: row.shas,pr_number: row.pr_number,type: row.type,scope: row.scope,breaking: row.breaking,subjects: row.subjects,body: row.body,paths: row.paths,noise_reason: row.noise_reason,revert_state: row.revert_state })),initial_review: snapshotResult.data?.initial_review ?? null,request_drops: snapshotResult.data?.request_drops ?? [],violations: snapshotResult.data?.violations ?? [] } as RunRecord;
  }
}

