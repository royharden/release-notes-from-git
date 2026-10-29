import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../../supabase/functions/_shared/core/providers/anthropic.ts';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/core/providers/openai-compatible.ts';
import { costUsd, readPrices, reservationUsd } from '../../supabase/functions/_shared/core/cost.ts';
const input = { units: [],prompt: 'untrusted café',promptHash: 'a'.repeat(64),modelId: 'test-model',maxTokens: 4096 };
describe('live provider and dated cost source contracts', () => {
  it('Anthropic sends the exact prepared request and parses usage',async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text',text: '{"bullets":[]}' }],usage: { input_tokens: 3,output_tokens: 4 } })));
    const provider = createAnthropicProvider('fake-key',{ fetch: fetcher }); const prepared = provider.prepare(input);
    const result = await provider.send(prepared); expect(result).toMatchObject({ status: 'ok',raw: { bullets: [] },usage: { input_tokens: 3,output_tokens: 4 } });
    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages',expect.objectContaining({ body: prepared.body,signal: expect.any(AbortSignal),redirect: 'error' }));
    expect(JSON.parse(prepared.body)).toMatchObject({ model: 'test-model',max_tokens: 4096,messages: [{ content: input.prompt }] });
  });
  it('openai compatible uses server endpoint, parses usage, refuses unsafe URL',async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"bullets":[]}' } }],usage: { prompt_tokens: 2,completion_tokens: 3 } })));
    const provider = createOpenAICompatibleProvider('fake-key','https://provider.test/v1',{ fetch: fetcher });
    expect((await provider.generate(input)).usage).toEqual({ input_tokens: 2,output_tokens: 3 });
    expect(provider.prepare(input).url).toBe('https://provider.test/v1/chat/completions');
    for (const url of ['http://provider.test','https://key@provider.test','https://provider.test/?key=x']) expect(() => createOpenAICompatibleProvider('fake',url)).toThrow();
  });
  it('response byte cap and abort timeout produce bounded failure results',async () => {
    const big = createAnthropicProvider('fake',{ fetch: async () => new Response('x'.repeat(1048577)) });
    expect(await big.generate(input)).toMatchObject({ raw: null,usage: null,error: 'response_too_large' });
    const timeout = createAnthropicProvider('fake',{ timeoutMs: 1,fetch: async (_url,options) => new Promise((_resolve,reject) => options?.signal?.addEventListener('abort',() => reject(new Error('abort')))) });
    expect((await timeout.generate(input)).status).toBe('timeout');
  });
  it('empty/unset/bad/oversized/undated/non-finite price sources fail closed',() => {
    for (const text of [undefined,'bad','x'.repeat(65537),'{"schema":"prices.v1","models":{"bad":{"provider":"anthropic","input_usd_per_mtok":-1}}}']) expect(readPrices(text)).toBeNull();
    expect(readPrices('{"schema":"prices.v1","models":{}}')?.models).toEqual({});
    const price = { provider: 'anthropic' as const,input_usd_per_mtok: 1,output_usd_per_mtok: 2,as_of: '2026-10-24' };
    expect(readPrices(JSON.stringify({ schema: 'prices.v1',models: { 'test-model': price } }))?.models['test-model']).toEqual(price);
    expect(readPrices(JSON.stringify({ schema: 'prices.v1',models: { 'test-model': { ...price,as_of: '2026-02-30' } } }))).toBeNull();
    expect(reservationUsd('é',10,price)).toBe(costUsd({ input_tokens: 2,output_tokens: 10 },price));
  });
});
