import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateLive } from '../../src/services/generation.ts';
import { pipeline } from '../helpers/fixtures.ts';

describe('browser live generation never falls back to demo', () => {
  it('reconstructs request restrictions from the actual chunk and retains source violation/drop indices',async () => {
    const p = pipeline('synthetic-traps'); const units = p.units.filter((unit) => unit.chunk_index === 0);
    const bullet = { text: 'A phantom claim',category: 'other',cites: ['f'.repeat(40)] };
    const violation = { index: 4,code: 'non_hex_cite',detail: 'one invalid cite' };
    const invoke = vi.fn(async () => ({ data: { status: 'completed',bullets: [],outsideRequest: [{ index: 9,bullet,reason: 'cite_out_of_range',evidence: 'not in request input',outside: bullet.cites }],violations: [violation] },error: null }));
    const generated = await generateLive({ functions: { invoke } } as unknown as SupabaseClient,'run-id',units);
    expect(invoke).toHaveBeenCalledWith('generate-notes',{ body: { run_id: 'run-id',chunk_index: 0,provider: 'anthropic' } });
    expect(generated.requestDrops[0]).toMatchObject({ index: 9,chunk_index: 0,bullet });
    expect(generated.requestDrops[0]?.requestShas).toEqual(units.filter((unit) => unit.noise_reason === null).flatMap((unit) => unit.shas));
    expect(generated.violations).toEqual([violation]); expect(generated.ledger).toEqual([]);
  });
  it('propagates failed/pending/malformed live responses instead of a mock success',async () => {
    const p = pipeline('synthetic-traps');
    const failed = { functions: { invoke: async () => ({ data: null,error: { message: '403 live_not_allowed' } }) } } as unknown as SupabaseClient;
    await expect(generateLive(failed,'run-id',p.units)).rejects.toThrow(/403 live_not_allowed/);
    for (const data of [{ status: 'pending' },{ status: 'completed',bullets: 'malformed' }]) {
      const client = { functions: { invoke: async () => ({ data,error: null }) } } as unknown as SupabaseClient;
      await expect(generateLive(client,'run-id',p.units)).rejects.toThrow(/incomplete response/);
    }
  });
});
