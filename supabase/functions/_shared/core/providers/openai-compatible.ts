import type { GenerationRequest } from './types.ts';
import { sendJson, tokenUsage } from './http.ts';
import type { LiveProvider, TransportOptions } from './http.ts';

/** Server configuration only. Never accept an endpoint in a browser request. */
export function createOpenAICompatibleProvider(key: string, baseUrl: string, options: TransportOptions = {}): LiveProvider {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid provider endpoint');
  const endpoint = `${base.href.replace(/\/$/,'')}/chat/completions`;
  const provider: LiveProvider = {
    name: 'openai_compatible',
    prepare(request: GenerationRequest) {
      return { url: endpoint,headers: { 'content-type': 'application/json',authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: request.modelId,max_tokens: request.maxTokens,temperature: 0,response_format: { type: 'json_object' },messages: [{ role: 'user',content: request.prompt }] }) };
    },
    send(prepared) { return sendJson(prepared,options,(value) => {
      const body = value as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const usage = tokenUsage(body.usage?.prompt_tokens,body.usage?.completion_tokens);
      try { return { raw: JSON.parse(body.choices?.[0]?.message?.content ?? ''),usage }; } catch { return { raw: null,usage }; }
    }); },
    generate(request) { return provider.send(provider.prepare(request)); },
  };
  return provider;
}

