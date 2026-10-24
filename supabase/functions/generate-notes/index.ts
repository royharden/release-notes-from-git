// Pinned Deno npm import; dependency resolution and deployment are deferred.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { handle } from './handler.ts';
import type { HandlerDeps, RequestRecord, Reservation, SealedRun } from './handler.ts';
import type { WireUnit } from '../_shared/core/units-wire.ts';
import { readPrices } from '../_shared/core/cost.ts';
import { createAnthropicProvider } from '../_shared/core/providers/anthropic.ts';
import { createOpenAICompatibleProvider } from '../_shared/core/providers/openai-compatible.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const options = { auth: { persistSession: false,autoRefreshToken: false } };
const userClient = (jwt: string) => createClient(url,anon,{ ...options,global: { headers: { Authorization: `Bearer ${jwt}` } } });
// Construct privileged clients only inside RPC methods reached after authenticated ownership proof.
function serviceClient() { return createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',options); }
function required<T>(data: T,error: unknown): NonNullable<T> { if (error || data === null) throw new Error('database_unavailable'); return data as NonNullable<T>; }
const deps: HandlerDeps = {
  anonKey: anon,origins,
  async authenticate(jwt) { const { data,error } = await userClient(jwt).auth.getUser(jwt); return error ? null : data.user?.id ?? null; },
  async readRun(jwt,id) { const { data,error } = await userClient(jwt).from('runs').select('*').eq('id',id).maybeSingle(); if (error) throw error; return data as SealedRun | null; },
  async readUnits(jwt,id,chunk) { const { data,error } = await userClient(jwt).from('run_units').select('*').eq('run_id',id).eq('chunk_index',chunk).order('ordinal'); return required(data,error) as WireUnit[]; },
  async readRequest(jwt,key) { const { data,error } = await userClient(jwt).from('llm_requests').select('status,output').eq('request_key',key).maybeSingle(); if (error) throw error; return data as RequestRecord | null; },
  configuration(name) {
    const prices = readPrices(Deno.env.get('MODEL_PRICES_JSON'));
    const modelId = name === 'anthropic' ? Deno.env.get('GENERATOR_MODEL_ID') : Deno.env.get('OPENAI_COMPATIBLE_MODEL_ID');
    const key = name === 'anthropic' ? Deno.env.get('ANTHROPIC_API_KEY') : Deno.env.get('OPENAI_COMPATIBLE_API_KEY');
    const price = modelId ? prices?.models[modelId] : undefined;
    if (!key || !modelId || !price || price.provider !== name) return null;
    try {
      const provider = name === 'anthropic' ? createAnthropicProvider(key) : createOpenAICompatibleProvider(key,Deno.env.get('OPENAI_COMPATIBLE_BASE_URL') ?? '');
      return { modelId,price,provider };
    } catch { return null; }
  },
  async reserve(i) {
    const { data,error } = await serviceClient().rpc('reserve_llm_attempt',{ p_run_id: i.runId,p_owner: i.owner,p_request_key: i.requestKey,p_chunk_index: i.chunk,p_provider: i.provider,p_model_id: i.modelId,p_prompt_hash: i.promptHash,p_price_as_of: i.priceAsOf,p_bound_usd: i.bound });
    return required(data,error) as Reservation;
  },
  async settle(i) {
    const { data,error } = await serviceClient().rpc('settle_llm_attempt',{ p_attempt_id: i.attemptId,p_input_tokens: i.usage?.input_tokens ?? null,p_output_tokens: i.usage?.output_tokens ?? null,p_cost_usd: i.cost,p_latency_ms: Math.ceil(i.latency),p_status: i.status,p_error_code: i.error,p_output: i.output });
    required(data,error);
  },
};
Deno.serve((request: Request) => handle(request,deps));
