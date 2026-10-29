// Future authorized live recording only. This file is never imported by eval or the application.
// --input <local gitlog> --fixture <id> --chunk <n> --max-usd <cap> --i-am-authorized
// Requires S29_RECORD_LIVE=1, ANTHROPIC_API_KEY, GENERATOR_MODEL_ID and dated config/prices.json.
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildPrompt, promptHash, allowedShasForPrompt, PROMPT_TEMPLATE_VERSION } from '../supabase/functions/_shared/core/prompt.ts';
import { parseModelOutput } from '../supabase/functions/_shared/core/output-schema.ts';
import { costUsd, readPrices, reservationUsd } from '../supabase/functions/_shared/core/cost.ts';
import { configVersion } from '../src/core/rulings/fingerprint.ts';
import { unitsOfChunk } from '../src/core/gitfacts/chunk.ts';
import { digest, insideRoot, makeRange, readJson, readText } from './eval.ts';
import type { EvalRecordingIndex, LiveEvidence } from './eval.ts';

export function requireAuthorization(argv: readonly string[], env: Record<string, string | undefined>): void {
  if (!argv.includes('--i-am-authorized') || env.S29_RECORD_LIVE !== '1') throw new Error('live recording requires --i-am-authorized AND S29_RECORD_LIVE=1');
  if (!env.ANTHROPIC_API_KEY || !env.GENERATOR_MODEL_ID) throw new Error('live recording requires ANTHROPIC_API_KEY and GENERATOR_MODEL_ID');
}
async function main(argv: string[]): Promise<void> {
  requireAuthorization(argv, process.env); // gate precedes any live adapter import or provider I/O
  let input = ''; let fixture = ''; let chunk = -1; let cap = NaN;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--i-am-authorized') continue;
    if (argv[i] === '--input') input = argv[++i] ?? '';
    else if (argv[i] === '--fixture') fixture = argv[++i] ?? '';
    else if (argv[i] === '--chunk') chunk = Number(argv[++i]);
    else if (argv[i] === '--max-usd') cap = Number(argv[++i]);
    else throw new Error('unknown/missing recording option');
  }
  if (!input || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(fixture) || !Number.isSafeInteger(chunk) || chunk < 0 || !Number.isFinite(cap) || cap <= 0 || cap > 5) throw new Error('input, fixture id, chunk and explicit cap (0,5] required');
  const pricesText = readText(insideRoot('config/prices.json'));
  const book = readPrices(pricesText);
  const modelId = process.env.GENERATOR_MODEL_ID!;
  const price = book?.models[modelId];
  if (!price || price.provider !== 'anthropic') throw new Error('dated Anthropic model price missing');
  const range = makeRange(fixture, fixture, readText(insideRoot(input)), []);
  const units = unitsOfChunk(range.units, chunk);
  if (units.length === 0) throw new Error('chunk does not exist');
  const prompt = buildPrompt(units); const hash = await promptHash(prompt.prompt);
  const request = { units, prompt: prompt.prompt, promptHash: hash, modelId, maxTokens: 4096 };
  const { createAnthropicProvider } = await import('../supabase/functions/_shared/core/providers/anthropic.ts');
  const provider = createAnthropicProvider(process.env.ANTHROPIC_API_KEY!);
  const prepared = provider.prepare(request);
  const reserved = reservationUsd(prepared.body, request.maxTokens, price);
  if (reserved > cap) throw new Error('recording reservation exceeds explicit cap; no call made');
  const file = `live-${hash}.json`;
  const journal = insideRoot(`fixtures/recorded/live-attempt-${hash}.json`);
  const outputPath = insideRoot(`fixtures/recorded/${file}`);
  const indexPath = insideRoot('fixtures/recorded/INDEX.json');
  const index = readJson<EvalRecordingIndex>(indexPath);
  if (existsSync(outputPath) || index.recordings.some((r) => r.file === file)) throw new Error('live recording already exists; refusing another paid call');
  const config = await configVersion();
  // Exclusive journal is a local once-only reservation, not the deployed service's SQL ledger. An interrupted
  // recording stays reserved and is never auto-retried. Inspect provider billing before any manual reconciliation.
  const common = { prompt_hash: hash, model_id: modelId, config_version: config, price_version: digest(pricesText),
    price, reserved_usd: reserved, authorized: true, provider: 'anthropic' };
  writeFileSync(journal, `${JSON.stringify({ schema: 'recording-attempt.v1', status: 'reserved', ...common }, null, 2)}\n`, { flag: 'wx' });
  const response = await provider.send(prepared); // sole live I/O; no automatic retry
  const actual = response.usage === null ? reserved : costUsd(response.usage, price);
  writeFileSync(journal, `${JSON.stringify({ schema: 'recording-attempt.v1', status: 'settled', ...common,
    outcome: response.status, usage: response.usage, actual_usd: actual, latency_ms: response.latency_ms }, null, 2)}\n`);
  if (response.status !== 'ok' || response.usage === null) throw new Error('live outcome/usage unavailable; charged at bound in local journal, recording not qualified');
  const parsed = parseModelOutput(response.raw, allowedShasForPrompt(units));
  if (!parsed.ok || actual > reserved) throw new Error('malformed output or reservation premise breached; inspect journal before continuing');
  const live: LiveEvidence = { authorized: true, model_id: modelId, config_version: config, price_version: digest(pricesText),
    price, actual_usd: actual, reserved_usd: reserved, latency_ms: response.latency_ms };
  writeFileSync(outputPath, `${JSON.stringify({ schema: 'recording.v1', output: response.raw, usage: response.usage, ledger: live }, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(insideRoot(`fixtures/recorded/live-${hash}.prompt.txt`), prompt.prompt, { flag: 'wx' });
  index.recordings.push({ file, fixture, chunk_index: chunk, prompt_template_version: PROMPT_TEMPLATE_VERSION,
    prompt_hash: hash, hash_verified: true, provenance: 'live', live });
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`Recorded one authorized chunk; actual USD ${actual.toFixed(6)}. No automatic follow-up call.\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`Recording refused: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
}
