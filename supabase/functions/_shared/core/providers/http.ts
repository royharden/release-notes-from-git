import type { GenerationRequest, GenerationResult, Provider, TokenUsage } from './types.ts';

export interface PreparedRequest { url: string; body: string; headers: Record<string,string> }
export interface LiveProvider extends Provider {
  prepare(request: GenerationRequest): PreparedRequest;
  send(prepared: PreparedRequest): Promise<GenerationResult>;
}
export interface TransportOptions { fetch?: typeof fetch; timeoutMs?: number; now?: () => number }
export function tokenUsage(input: unknown, output: unknown): TokenUsage | null {
  return typeof input === 'number' && typeof output === 'number' && Number.isSafeInteger(input) && Number.isSafeInteger(output) && input >= 0 && output >= 0
    ? { input_tokens: input, output_tokens: output } : null;
}
export async function sendJson(prepared: PreparedRequest, options: TransportOptions, decode: (body: unknown) => Pick<GenerationResult,'raw'|'usage'>): Promise<GenerationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000,Math.max(1,options.timeoutMs ?? 30000)));
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const response = await (options.fetch ?? fetch)(prepared.url,{ method: 'POST',headers: prepared.headers,body: prepared.body,signal: controller.signal,redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); return { raw: null,usage: null,latency_ms: now()-started,status: 'http_error',error: `http_${response.status}` }; }
    const reader = response.body?.getReader();
    if (!reader) return { raw: null,usage: null,latency_ms: now()-started,status: 'ok' };
    const decoder = new TextDecoder(); let body = ''; let bytes = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1048576) { await reader.cancel(); return { raw: null,usage: null,latency_ms: now()-started,status: 'ok',error: 'response_too_large' }; }
      body += decoder.decode(part.value,{ stream: true });
    }
    body += decoder.decode();
    let decoded: Pick<GenerationResult,'raw'|'usage'>;
    try { decoded = decode(JSON.parse(body)); } catch { decoded = { raw: null,usage: null }; }
    return { ...decoded,latency_ms: Math.max(0,now()-started),status: 'ok' };
  } catch {
    return { raw: null,usage: null,latency_ms: Math.max(0,now()-started),status: controller.signal.aborted ? 'timeout' : 'network_error' };
  } finally { clearTimeout(timer); }
}

