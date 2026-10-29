import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRunRepository } from '../../src/data/supabase-repo.ts';
import { initialReviewState } from '../../src/core/rulings/replay.ts';
import { makeReviewValidator } from '../../src/services/generation.ts';
import type { RequestDrop } from '../../src/data/repo.ts';
import type { Ruling } from '../../src/core/rulings/types.ts';
import { pipeline } from '../helpers/fixtures.ts';

type Row = Record<string,unknown>;
interface Result { data: unknown; error: { code: string; message: string } | null }
/** Tiny PostgREST-shaped fake; asserts adapter serialization, never claims to exercise RLS/SQL. */
class Query implements PromiseLike<Result> {
  table: string; rows: Map<string,Row[]>; filters: [string,unknown][] = []; pending: Row | Row[] | null = null;
  constructor(table: string,rows: Map<string,Row[]>) { this.table = table; this.rows = rows; }
  select() { return this; } order() { return this; }
  eq(key: string,value: unknown) { this.filters.push([key,value]); return this; }
  insert(value: Row | Row[]) { this.pending = structuredClone(value); return this; }
  result(single = false): Result {
    const rows = this.rows.get(this.table) ?? [];
    if (this.pending) {
      const fresh = Array.isArray(this.pending) ? this.pending : [this.pending]; this.pending = null;
      const key = this.table === 'rulings' ? 'client_event_id' : 'run_id';
      if (fresh.some((item) => rows.some((row) => row[key] === item[key]))) return { data: null,error: { code: '23505',message: 'duplicate' } };
      rows.push(...fresh.map((item) => ({ owner: 'owner',actor: 'owner',...item }))); this.rows.set(this.table,rows);
    }
    const filtered = rows.filter((row) => this.filters.every(([key,value]) => row[key] === value));
    return { data: structuredClone(single ? filtered[0] ?? null : filtered),error: null };
  }
  single() { return Promise.resolve(this.result(true)); } maybeSingle() { return this.single(); }
  then<T1 = Result,T2 = never>(fulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,rejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> { return Promise.resolve(this.result()).then(fulfilled,rejected); }
}
describe('Supabase snapshot and full ruling serialization', () => {
  it('saveBullets/getRun retains exact initial_review + requestShas/chunk_index and complete append-only events',async () => {
    const p = pipeline('synthetic-traps'); const runId = 'run-id';
    const bullet = { text: 'wrong request',category: 'other' as const,cites: ['f'.repeat(40)] };
    const drop: RequestDrop = { index: 3,bullet,reason: 'cite_out_of_range',evidence: 'not in request input',outside: bullet.cites,chunk_index: 0,requestShas: p.units.filter((unit) => unit.chunk_index === 0).flatMap((unit) => unit.shas) };
    const initial = await initialReviewState([bullet],makeReviewValidator(p.ctx,[drop]));
    const rows = new Map<string,Row[]>([
      ['runs',[{ id: runId,owner: 'owner',status: 'sealed',config_version: 'version' }]],
      ['run_units',p.units.map((unit) => ({ ...unit,run_id: runId,owner: 'owner' }))],
    ]);
    const client = { from: (table: string) => new Query(table,rows) } as unknown as SupabaseClient;
    const repository = new SupabaseRunRepository(client,'owner');
    const violations = [{ index: 4,code: 'non_hex_cite' as const,detail: 'source violation' }];
    await repository.saveBullets(runId,initial,[drop],violations);
    await repository.saveBullets(runId,initial,[drop],violations); // idempotent retry of immutable snapshot
    const loaded = await repository.getRun(runId);
    expect(loaded.initial_review).toEqual(initial); expect(loaded.request_drops).toEqual([drop]); expect(loaded.violations).toEqual(violations); expect(loaded.units).toEqual(p.units);
    const event: Ruling = { id: crypto.randomUUID(),action: 'remove',target_key: initial.bullets[0]!.key,payload: {},fingerprint: 'f',config_version: 'version',approval_hash: null,reason: null,actor: 'owner',created_at: '2026-10-24T00:00:00.000Z' };
    await repository.appendRuling(runId,event); await repository.appendRuling(runId,event);
    expect(await repository.listRulings(runId)).toEqual([event]);
    await expect(repository.appendRuling(runId,{ ...event,target_key: 'changed' })).rejects.toThrow(/already belongs/);
    loaded.request_drops[0]!.requestShas.length = 0;
    expect((await repository.getRun(runId)).request_drops[0]!.requestShas.length).toBeGreaterThan(0);
  });
  it('rejects mismatched actor before a browser write',async () => {
    const repository = new SupabaseRunRepository({} as SupabaseClient,'owner');
    await expect(repository.appendRuling('run',{ actor: 'other' } as Ruling)).rejects.toThrow(/actor/);
  });
});
