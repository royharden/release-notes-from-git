import type { GenerationRequest } from './types.ts';
import { sendJson, tokenUsage } from './http.ts';
import type { LiveProvider, TransportOptions } from './http.ts';

export function createAnthropicProvider(key: string, options: TransportOptions = {}): LiveProvider {
  const provider: LiveProvider = {
    name: 'anthropic',
    prepare(request: GenerationRequest) {
      return { url: 'https://api.anthropic.com/v1/messages', headers: { 'content-type': 'application/json','x-api-key': key,'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: request.modelId,max_tokens: request.maxTokens,temperature: 0,messages: [{ role: 'user',content: request.prompt }] }) };
    },
    send(prepared) { return sendJson(prepared,options,(value) => {
      const body = value as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = Array.isArray(body.content) ? body.content.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('') : '';
      const usage = tokenUsage(body.usage?.input_tokens,body.usage?.output_tokens);
      try { return { raw: JSON.parse(text),usage }; } catch { return { raw: null,usage }; }
    }); },
    generate(request) { return provider.send(provider.prepare(request)); },
  };
  return provider;
}

