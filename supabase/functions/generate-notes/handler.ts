import { sha256Canonical } from '../_shared/core/hash.ts';
import { allowedShasForPrompt, buildPrompt, promptHash, PROMPT_TEMPLATE_VERSION } from '../_shared/core/prompt.ts';
import { parseModelOutput } from '../_shared/core/output-schema.ts';
import type { ModelBullet, OutsideRequestDrop, BulletViolation } from '../_shared/core/output-schema.ts';
import { promptChars } from '../_shared/core/units-wire.ts';
import type { WireUnit } from '../_shared/core/units-wire.ts';
import { costUsd, reservationUsd } from '../_shared/core/cost.ts';
import type { LiveProviderName, ModelPrice } from '../_shared/core/cost.ts';
import type { LiveProvider } from '../_shared/core/providers/http.ts';
import type { TokenUsage } from '../_shared/core/providers/types.ts';

export interface SealedRun { id: string; owner: string; status: string; revision_sha256: string | null; chunk_count: number; omissions_ack_at: string | null; has_unit_omissions: boolean; parse_report: { rejected: number } }
export interface StoredOutput { bullets: ModelBullet[]; outsideRequest: OutsideRequestDrop[]; violations: BulletViolation[]; usage: TokenUsage | null }
export interface RequestRecord { status: 'in_flight'|'completed'|'failed'|'failed_unknown'; output: StoredOutput | null }
export interface Reservation { status?: 'reserved'|'completed'; attempt_id?: string; output?: StoredOutput; error?: string }
export interface ReservationInput { runId: string; owner: string; requestKey: string; chunk: number; provider: LiveProviderName; modelId: string; promptHash: string; priceAsOf: string; bound: number }
export interface Settlement { attemptId: string; usage: TokenUsage | null; cost: number; latency: number; status: 'completed'|'failed'|'failed_unknown'; error: string | null; output: StoredOutput | null }
/** Implementations keep user-scoped reads separate from privileged RPCs. */
export interface HandlerDeps {
  anonKey: string; origins: readonly string[];
  authenticate(jwt: string): Promise<string | null>;
  readRun(jwt: string,id: string): Promise<SealedRun | null>;
  readUnits(jwt: string,id: string,chunk: number): Promise<WireUnit[]>;
  readRequest(jwt: string,key: string): Promise<RequestRecord | null>;
  configuration(provider: LiveProviderName): { modelId: string; price: ModelPrice; provider: LiveProvider } | null;
  reserve(input: ReservationInput): Promise<Reservation>;
  settle(input: Settlement): Promise<void>;
}
async function boundedRequestText(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder(); let bytes = 0; let text = '';
  for (;;) {
    const part = await reader.read(); if (part.done) return text + decoder.decode();
    bytes += part.value.byteLength;
    if (bytes > 2048) { await reader.cancel(); return null; }
    text += decoder.decode(part.value,{ stream: true });
  }
}
export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  const allowed = origin !== null && deps.origins.includes(origin);
  const headers: Record<string,string> = { 'content-type': 'application/json','vary': 'Origin' };
  if (allowed) Object.assign(headers,{ 'access-control-allow-origin': origin,'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info','access-control-allow-methods': 'POST,OPTIONS' });
  const reply = (status: number,body: unknown) => new Response(JSON.stringify(body),{ status,headers });
  if (origin !== null && !allowed) return reply(403,{ error: 'origin_not_allowed' });
  if (req.method === 'OPTIONS') return new Response(null,{ status: 204,headers });
  if (req.method !== 'POST') return reply(400,{ error: 'invalid_method' });
  const jwt = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt || jwt === deps.anonKey) return reply(401,{ error: 'unauthorized' });
  try {
    const owner = await deps.authenticate(jwt);
    if (!owner) return reply(401,{ error: 'unauthorized' });
    // Browser payload is deliberately tiny; no untrusted endpoint, model or prompt is accepted.
    const raw = await boundedRequestText(req);
    if (raw === null) return reply(400,{ error: 'invalid_request' });
    let input: { run_id?: unknown; chunk_index?: unknown; provider?: unknown };
    try { input = JSON.parse(raw) as typeof input; } catch { return reply(400,{ error: 'invalid_request' }); }
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !['run_id','chunk_index','provider'].includes(key)) || typeof input.run_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.run_id) || typeof input.chunk_index !== 'number' || !Number.isInteger(input.chunk_index) || !['anthropic','openai_compatible'].includes(String(input.provider))) return reply(400,{ error: 'invalid_request' });
    const providerName = input.provider as LiveProviderName;
    const run = await deps.readRun(jwt,input.run_id);
    if (!run || run.owner !== owner) return reply(404,{ error: 'run_not_found' });
    if (run.status !== 'sealed' || !run.revision_sha256 || input.chunk_index < 0 || input.chunk_index >= run.chunk_count || ((run.parse_report.rejected > 0 || run.has_unit_omissions) && !run.omissions_ack_at)) return reply(400,{ error: 'invalid_run' });
    const units = await deps.readUnits(jwt,run.id,input.chunk_index);
    if (units.length === 0 || units.length > 40 || units.some((u) => u.chunk_index !== input.chunk_index) || units.reduce((n,u) => n + promptChars(u),0) > 60000) return reply(400,{ error: 'invalid_chunk' });
    const configuration = deps.configuration(providerName);
    if (!configuration || !configuration.modelId || configuration.price.provider !== providerName) return reply(503,{ error: 'live_not_configured' });
    const prompt = buildPrompt(units); const hash = await promptHash(prompt.prompt);
    const requestKey = await sha256Canonical([run.id,run.revision_sha256,input.chunk_index,PROMPT_TEMPLATE_VERSION,hash,configuration.modelId,providerName]);
    const cached = await deps.readRequest(jwt,requestKey);
    if (cached?.status === 'completed' && cached.output) return reply(200,{ request_key: requestKey,status: 'completed',...cached.output });
    if (cached?.status === 'in_flight') return reply(409,{ request_key: requestKey,status: 'pending' });
    if (cached?.status === 'failed_unknown') return reply(409,{ request_key: requestKey,error: 'failed_unknown',detail: 'Paid outcome unknown; this request will not be automatically retried.' });
    const maxTokens = 4096;
    const prepared = configuration.provider.prepare({ units,prompt: prompt.prompt,promptHash: hash,modelId: configuration.modelId,maxTokens });
    const bound = reservationUsd(prepared.body,maxTokens,configuration.price);
    if (!Number.isFinite(bound) || bound <= 0) return reply(503,{ error: 'invalid_price' });
    const reserved = await deps.reserve({ runId: run.id,owner,requestKey,chunk: input.chunk_index,provider: providerName,modelId: configuration.modelId,promptHash: hash,priceAsOf: configuration.price.as_of,bound });
    if (reserved.status === 'completed' && reserved.output) return reply(200,{ request_key: requestKey,status: 'completed',...reserved.output });
    if (reserved.error) {
      const code = reserved.error === 'live_not_allowed' ? 403 : reserved.error === 'budget_exceeded' ? 402 : reserved.error === 'run_not_found' ? 404 : 409;
      return reply(code,{ request_key: requestKey,...(reserved.error === 'pending' ? { status: 'pending' } : { error: reserved.error }) });
    }
    if (!reserved.attempt_id || reserved.status !== 'reserved') return reply(503,{ error: 'reservation_unavailable' });
    // No paid I/O exists above this successful reservation boundary.
    let result;
    try { result = await configuration.provider.send(prepared); }
    catch { result = { raw: null,usage: null,latency_ms: 0,status: 'network_error' as const }; }
    const parsed = result.status === 'ok' ? parseModelOutput(result.raw,allowedShasForPrompt(units)) : null;
    const output: StoredOutput | null = parsed?.ok ? { bullets: parsed.bullets,outsideRequest: parsed.outsideRequest,violations: parsed.violations,usage: result.usage } : null;
    const error = result.status === 'timeout' ? 'upstream_timeout' : result.status !== 'ok' ? 'upstream_failure' : output === null ? 'upstream_malformed' : null;
    const uncertain = result.status === 'timeout' || result.status === 'network_error';
    const usage = result.usage;
    const actual = usage ? costUsd(usage,configuration.price) : bound;
    // Transport adapters return bounded results. Settlement errors are explicit; never return an unpaid success.
    await deps.settle({ attemptId: reserved.attempt_id,usage,cost: actual,latency: result.latency_ms,status: output ? 'completed' : uncertain ? 'failed_unknown' : 'failed',error,output });
    if (error) return reply(result.status === 'timeout' ? 504 : 502,{ request_key: requestKey,error });
    return reply(200,{ request_key: requestKey,status: 'completed',...output });
  } catch { return reply(503,{ error: 'service_unavailable' }); }
}

