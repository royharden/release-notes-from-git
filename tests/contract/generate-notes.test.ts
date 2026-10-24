import { describe, expect, it, vi } from 'vitest';
import { handle } from '../../supabase/functions/generate-notes/handler.ts';
import type { HandlerDeps, ReservationInput, Settlement } from '../../supabase/functions/generate-notes/handler.ts';
import type { WireUnit } from '../../supabase/functions/_shared/core/units-wire.ts';
import { createAnthropicProvider } from '../../supabase/functions/_shared/core/providers/anthropic.ts';
import { reservationUsd } from '../../supabase/functions/_shared/core/cost.ts';

const runId = '00000000-0000-4000-8000-000000000001';
const sha = 'a'.repeat(40);
const unit: WireUnit = { ordinal: 0,unit_key: sha,shas: [sha],pr_number: null,type: 'feat',scope: null,breaking: false,subjects: ['feat: café exports'],body: '',paths: ['exports.ts'],noise_reason: null,revert_state: 'active',chunk_index: 0 };
const price = { provider: 'anthropic' as const,input_usd_per_mtok: 1,output_usd_per_mtok: 2,as_of: '2026-10-24' };
const output = { bullets: [{ text: 'Export café files',category: 'feature' as const,cites: [sha] }],outsideRequest: [],violations: [],usage: { input_tokens: 10,output_tokens: 10 } };
function request(body: unknown = { run_id: runId,chunk_index: 0,provider: 'anthropic' },jwt: string | null = 'user-jwt',origin = 'https://app.test') {
  return new Request('https://edge.test/generate-notes',{ method: 'POST',headers: { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),origin },body: JSON.stringify(body) });
}
function fixture() {
  const events: string[] = []; const settlements: Settlement[] = []; let reserved: ReservationInput | null = null;
  const provider = createAnthropicProvider('fake',{ fetch: vi.fn() });
  const send = vi.fn(async () => { events.push('provider'); return { status: 'ok' as const,raw: { bullets: output.bullets },usage: output.usage,latency_ms: 7 }; });
  const deps: HandlerDeps = {
    anonKey: 'anon-key',origins: ['https://app.test'],authenticate: vi.fn(async () => 'owner'),
    readRun: vi.fn(async () => ({ id: runId,owner: 'owner',status: 'sealed',revision_sha256: 'b'.repeat(64),chunk_count: 1,omissions_ack_at: null,has_unit_omissions: false,parse_report: { rejected: 0 } })),
    readUnits: vi.fn(async () => [unit]),readRequest: vi.fn(async () => null),
    configuration: vi.fn(() => ({ modelId: 'test-model',price,provider: { ...provider,send } })),
    reserve: vi.fn(async (value) => { events.push('reserve'); reserved = value; return { status: 'reserved',attempt_id: 'attempt-1' }; }),
    settle: vi.fn(async (value) => { events.push('settle'); settlements.push(value); }),
  };
  return { deps,events,settlements,send,reserved: () => reserved };
}
describe('pure live handler with injected dependencies (no network)', () => {
  it.each([null,'anon-key'])('401 for absent JWT or anon bearer %s',async (jwt) => {
    const f = fixture(); expect((await handle(request(undefined,jwt),f.deps)).status).toBe(401); expect(f.deps.readRun).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('401 when auth.getUser rejects caller',async () => { const f = fixture(); f.deps.authenticate = async () => null; expect((await handle(request(),f.deps)).status).toBe(401); });
  it('404 for a missing or foreign owned run before privileged access',async () => {
    for (const foreign of [null,{ id: runId,owner: 'other',status: 'sealed',revision_sha256: 'b',chunk_count: 1,omissions_ack_at: null,has_unit_omissions: false,parse_report: { rejected: 0 } }]) {
      const f = fixture(); f.deps.readRun = async () => foreign; expect((await handle(request(),f.deps)).status).toBe(404); expect(f.deps.reserve).not.toHaveBeenCalled();
    }
  });
  it.each(['draft','unacknowledged','chunk'])('400 for %s input',async (kind) => {
    const f = fixture(); const original = await f.deps.readRun('jwt',runId); if (!original) throw new Error('fixture');
    f.deps.readRun = async () => ({ ...original,status: kind === 'draft' ? 'draft' : 'sealed',has_unit_omissions: kind === 'unacknowledged' });
    expect((await handle(request({ run_id: runId,chunk_index: kind === 'chunk' ? 1 : 0,provider: 'anthropic' }),f.deps)).status).toBe(400); expect(f.send).not.toHaveBeenCalled();
  });
  it('400 for malformed JSON, excess fields, or invalid prompt chunks',async () => {
    const f = fixture();
    expect((await handle(new Request('https://edge.test',{ method: 'POST',headers: { authorization: 'Bearer user-jwt' },body: '{' }),f.deps)).status).toBe(400);
    expect((await handle(request({ run_id: runId,chunk_index: 0,provider: 'anthropic',model: 'untrusted' }),f.deps)).status).toBe(400);
    f.deps.readUnits = async () => Array.from({ length: 41 },() => unit);
    expect((await handle(request(),f.deps)).status).toBe(400); expect(f.deps.reserve).not.toHaveBeenCalled();
  });
  it.each([['budget_exceeded',402],['live_not_allowed',403],['pending',409],['failed_unknown',409],['attempt_limit',409]] as const)('%s refuses before paid I/O',async (error,status) => {
    const f = fixture(); f.deps.reserve = async () => ({ error }); const response = await handle(request(),f.deps);
    expect(response.status).toBe(status); expect(f.send).not.toHaveBeenCalled(); expect(f.deps.settle).not.toHaveBeenCalled();
    if (error === 'pending') expect(await response.json()).toMatchObject({ status: 'pending' });
  });
  it.each(['in_flight','failed_unknown'] as const)('409 durable %s never auto-reissues',async (status) => {
    const f = fixture(); f.deps.readRequest = async () => ({ status,output: null });
    expect((await handle(request(),f.deps)).status).toBe(409); expect(f.deps.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('completed request and racing completed reservation return cached output without a paid call',async () => {
    const f = fixture(); f.deps.readRequest = async () => ({ status: 'completed',output });
    expect((await handle(request(),f.deps)).status).toBe(200); expect(f.deps.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    f.deps.readRequest = async () => null; f.deps.reserve = async () => ({ status: 'completed',output });
    expect((await handle(request(),f.deps)).status).toBe(200); expect(f.send).not.toHaveBeenCalled();
  });
  it('503 missing key/model/dated price cannot reserve or call',async () => {
    const f = fixture(); f.deps.configuration = () => null;
    expect((await handle(request(),f.deps)).status).toBe(503); expect(f.deps.reserve).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('bounds the exact full serialized UTF8 request incl. envelope and output tokens, then reserves before send',async () => {
    const f = fixture(); const response = await handle(request(),f.deps); expect(response.status).toBe(200);
    const configuration = f.deps.configuration('anthropic')!;
    const { buildPrompt,promptHash } = await import('../../supabase/functions/_shared/core/prompt.ts');
    const prompt = buildPrompt([unit]);
    const prepared = configuration.provider.prepare({ units: [unit],prompt: prompt.prompt,promptHash: await promptHash(prompt.prompt),modelId: configuration.modelId,maxTokens: 4096 });
    expect(f.reserved()?.bound).toBe(reservationUsd(prepared.body,4096,price));
    expect(new TextEncoder().encode(prepared.body).byteLength).toBeGreaterThan(prepared.body.length);
    expect(f.events).toEqual(['reserve','provider','settle']); expect(f.settlements).toHaveLength(1);
  });
  it('502 malformed output settles once, retaining known usage',async () => {
    const f = fixture(); f.send.mockResolvedValue({ status: 'ok',raw: { bullets: [],version: 'bad' } as unknown as { bullets: typeof output.bullets },usage: output.usage,latency_ms: 7 });
    expect((await handle(request(),f.deps)).status).toBe(502); expect(f.settlements).toHaveLength(1); expect(f.settlements[0]).toMatchObject({ status: 'failed',error: 'upstream_malformed',usage: output.usage });
  });
  it('504 timeout settles at the full reservation; unknown failure cannot become success',async () => {
    const f = fixture(); const config = f.deps.configuration('anthropic')!;
    f.deps.configuration = () => ({ ...config,provider: { ...config.provider,send: async () => ({ status: 'timeout',raw: null,usage: null,latency_ms: 30000 }) } });
    expect((await handle(request(),f.deps)).status).toBe(504); expect(f.settlements[0]).toMatchObject({ status: 'failed_unknown',usage: null,cost: f.reserved()?.bound });
  });
  it.each(['http_error','network_error'] as const)('502 %s settles once conservatively',async (status) => {
    const f = fixture(); const config = f.deps.configuration('anthropic')!;
    f.deps.configuration = () => ({ ...config,provider: { ...config.provider,send: async () => ({ status,raw: null,usage: null,latency_ms: 2 }) } });
    expect((await handle(request(),f.deps)).status).toBe(502);
    expect(f.settlements).toHaveLength(1);
    expect(f.settlements[0]).toMatchObject({ usage: null,cost: f.reserved()?.bound,status: status === 'network_error' ? 'failed_unknown' : 'failed' });
  });
  it('settlement failure returns 503; no automatic second provider call',async () => {
    const f = fixture(); f.deps.settle = async () => { throw new Error('database unavailable'); };
    expect((await handle(request(),f.deps)).status).toBe(503); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('enforces CORS allowlist and handles permitted preflight without authentication',async () => {
    const f = fixture(); expect((await handle(request(undefined,'user-jwt','https://foreign.test'),f.deps)).status).toBe(403);
    const response = await handle(new Request('https://edge.test',{ method: 'OPTIONS',headers: { origin: 'https://app.test' } }),f.deps);
    expect(response.status).toBe(204); expect(response.headers.get('access-control-allow-origin')).toBe('https://app.test'); expect(f.send).not.toHaveBeenCalled();
  });
});
