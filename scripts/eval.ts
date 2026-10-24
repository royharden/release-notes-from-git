// Offline evaluation: no builder, recorder, live adapter, fetch, key lookup or paid call is on this path.
// Node >=22.18. `--split synthetic|dev|heldout [--seed uint32] [--freeze-dev|--heldout-once]`;
// completed heldout labels are imported separately with `--split heldout --audit-only`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPrompt, allowedShasForPrompt, promptHash, PROMPT_TEMPLATE_VERSION } from '../supabase/functions/_shared/core/prompt.ts';
import { createMockProvider, findRecording } from '../supabase/functions/_shared/core/providers/mock.ts';
import type { RecordingEntry, RecordingFile, RecordingIndex } from '../supabase/functions/_shared/core/providers/mock.ts';
import { isCategory, parseModelOutput } from '../supabase/functions/_shared/core/output-schema.ts';
import { costUsd, readPrices } from '../supabase/functions/_shared/core/cost.ts';
import type { ModelPrice } from '../supabase/functions/_shared/core/cost.ts';
import type { WireUnit } from '../supabase/functions/_shared/core/units-wire.ts';
import { ruleBasedBullets } from '../src/core/baseline/rule-based.ts';
import { sectionGate } from '../src/core/baseline/section-gate.ts';
import { resolveCite } from '../src/core/cited/resolve.ts';
import { DEFAULT_IGNORE, DEFAULT_THRESHOLDS } from '../src/core/config.ts';
import { buildFacts } from '../src/core/gitfacts/facts.ts';
import type { FactIndex } from '../src/core/gitfacts/facts.ts';
import { groupUnits, uncoveredUnits } from '../src/core/gitfacts/units.ts';
import { chunkUnits, unitsOfChunk } from '../src/core/gitfacts/chunk.ts';
import { parseLog } from '../src/core/gitlog/parse.ts';
import { configVersion } from '../src/core/rulings/fingerprint.ts';
import { validateAll, validateBullet, validatorContext } from '../src/core/validate/validate.ts';
import type { ValidatorContext } from '../src/core/validate/validate.ts';
import type { BulletInput, CiteResolution, ReasonCode } from '../src/core/validate/reasons.ts';
import { OPERATORS, mutate, seededRandom } from './mutate.ts';
import type { GenuineEntry, MutationAttempt } from './mutate.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GOLD_SEED = 2901;
export type GoldSplit = 'dev' | 'heldout';
export interface GoldRange {
  id: string; repository: string; split: GoldSplit; from_ref: string; to_ref: string;
  gitlog: string; gitlog_sha256: string; entries: string; entries_sha256: string;
}
export interface Screening {
  id: string; repository: string; included: boolean; reason: string; license: string;
  notes_kind: string; notes_url: string; license_url: string; retrieved_on: string;
}
export interface GoldManifest {
  schema: 'gold-manifest.v1'; seed: number; frozen_on: string | null;
  target: { ranges: 20; repositories: 8 }; qualified_ranges: number; qualified_repositories: number;
  target_status: 'met' | 'unmet'; screening: Screening[]; ranges: GoldRange[];
}
export interface RangeData {
  id: string; repository: string; facts: FactIndex; units: WireUnit[]; ctx: ValidatorContext;
  entries: GenuineEntry[]; fingerprint: string; unitBySha: Map<string, string>;
}
export interface Fraction { numerator: number; denominator: number; value: number | null }
export function fraction(numerator: number, denominator: number): Fraction {
  if (![numerator, denominator].every((n) => Number.isSafeInteger(n) && n >= 0) || numerator > denominator) throw new Error('invalid metric counts');
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}
export function micro(counts: readonly Pick<Fraction, 'numerator' | 'denominator'>[]): Fraction {
  return fraction(counts.reduce((n, c) => n + c.numerator, 0), counts.reduce((n, c) => n + c.denominator, 0));
}
export function digest(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }
export function readText(path: string): string { return readFileSync(path, 'utf8'); }
export function readJson<T>(path: string): T { return JSON.parse(readText(path)) as T; }
export function insideRoot(path: string): string {
  const absolute = resolve(ROOT, path);
  const rel = relative(ROOT, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('artifact path must be inside product repository');
  return absolute;
}
export function repositorySplits(repositories: readonly string[], seed: number): Map<string, GoldSplit> {
  const items = [...new Set(repositories)].sort();
  const random = seededRandom(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  const devCount = Math.ceil(items.length / 2);
  return new Map(items.map((repo, i) => [repo, i < devCount ? 'dev' : 'heldout']));
}
/** Metadata-only check; dev never opens a held-out artifact. Repository names are case-insensitive on GitHub. */
export function assertSplitIsolation(manifest: GoldManifest): void {
  if (manifest.schema !== 'gold-manifest.v1' || manifest.target.ranges !== 20 || manifest.target.repositories !== 8) throw new Error('gold target/schema changed; explicit scope decision required');
  const normalized = manifest.ranges.map((r) => r.repository.toLowerCase());
  const expected = repositorySplits(normalized, manifest.seed);
  const ids = new Set<string>();
  const rangeKeys = new Set<string>();
  const artifactSplits = new Map<string, GoldSplit>();
  for (const range of manifest.ranges) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(range.id) || ids.has(range.id)) throw new Error('duplicate or invalid range id');
    ids.add(range.id);
    const rangeKey = `${range.repository.toLowerCase()}:${range.from_ref}..${range.to_ref}`;
    if (rangeKeys.has(rangeKey)) throw new Error('duplicate repository range');
    rangeKeys.add(rangeKey);
    if (expected.get(range.repository.toLowerCase()) !== range.split) throw new Error('repository split leak or seed mismatch');
    for (const [path, hash] of [[range.gitlog, range.gitlog_sha256], [range.entries, range.entries_sha256]]) {
      if (!path?.startsWith('gold/ranges/') || !/^[0-9a-f]{64}$/.test(hash ?? '')) throw new Error('missing gold artifact/hash');
      insideRoot(path!);
      for (const key of [`path:${path}`, `hash:${hash}`]) {
        const prior = artifactSplits.get(key);
        if (prior !== undefined && prior !== range.split) throw new Error('artifact crosses repository splits');
        artifactSplits.set(key, range.split);
      }
    }
  }
  if (manifest.qualified_ranges !== ids.size || manifest.qualified_repositories !== expected.size) throw new Error('qualified counts disagree with manifest');
  const met = ids.size >= 20 && expected.size >= 8;
  if (manifest.target_status !== (met ? 'met' : 'unmet')) throw new Error('gold target status disagrees with counts');
}

export function makeRange(id: string, repository: string, text: string, entries: GenuineEntry[]): RangeData {
  const parsed = parseLog(text);
  if (!parsed.ok) throw new Error(`${id}: input refused: ${parsed.report.fileError?.code}`);
  const facts = buildFacts(parsed.log, DEFAULT_IGNORE);
  const grouped = groupUnits(facts, DEFAULT_IGNORE);
  if (!grouped.ok) throw new Error(`${id}: ${grouped.code}`);
  const chunked = chunkUnits(grouped.units);
  if (!chunked.ok || chunked.oversized.length > 0) throw new Error(`${id}: chunk or oversized-unit omission; dataset needs explicit review`);
  const unitBySha = new Map(chunked.units.flatMap((u) => u.shas.map((sha) => [sha, u.unit_key] as const)));
  const duplicateShas = new Set(chunked.units.filter((u) => grouped.possibleDuplicates.has(u.unit_key)).flatMap((u) => u.shas));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id) || !entry.bullet?.text || !isCategory(entry.bullet.category) ||
      !Array.isArray(entry.bullet.cites) || entry.bullet.cites.length === 0 ||
      (entry.pr_number !== null && (!Number.isSafeInteger(entry.pr_number) || entry.pr_number <= 0))) throw new Error(`${id}: bad genuine entry`);
    ids.add(entry.id);
    // Genuine entries must map to actual accepted commits. They need not pass the lexical validator.
    if (entry.bullet.cites.some((sha) => !facts.commits.has(sha))) throw new Error(`${id}/${entry.id}: unmapped genuine citation`);
  }
  return { id, repository, facts, units: chunked.units, entries, unitBySha,
    ctx: validatorContext(facts, { thresholds: DEFAULT_THRESHOLDS, possibleDuplicateShas: duplicateShas }),
    fingerprint: digest(JSON.stringify({ text, entries })) };
}
export function loadGold(manifest: GoldManifest, split: GoldSplit): RangeData[] {
  assertSplitIsolation(manifest);
  return manifest.ranges.filter((r) => r.split === split).map((r) => {
    const log = readText(insideRoot(r.gitlog));
    const entries = readText(insideRoot(r.entries));
    if (digest(log) !== r.gitlog_sha256 || digest(entries) !== r.entries_sha256) throw new Error(`${r.id}: frozen artifact changed`);
    return makeRange(r.id, r.repository, log, JSON.parse(entries) as GenuineEntry[]);
  });
}
function loadSynthetic(): RangeData[] {
  const data = readJson<{ schema: string; fixtures: { id: string; entries: GenuineEntry[] }[] }>(insideRoot('fixtures/gitlog/synthetic-entries.json'));
  if (data.schema !== 'synthetic-entries.v1') throw new Error('bad synthetic entry schema');
  return data.fixtures.map(({ id, entries }) => {
    if (!['synthetic-small', 'synthetic-traps', 'synthetic-untyped'].includes(id)) throw new Error('unknown synthetic fixture');
    return makeRange(id, id, readText(insideRoot(`fixtures/gitlog/${id}.gitlog.v1.json`)), entries);
  });
}

/** PR-entry recall: a human entry counts once when ANY kept cite resolves to one of its mapped commits. */
export function recall(entries: readonly GenuineEntry[], bullets: readonly BulletInput[], facts: FactIndex): Fraction {
  const cited = new Set(bullets.flatMap((b) => b.cites.map((cite) => resolveCite(cite, { facts })))
    .filter((r) => r.status === 'resolved').map((r) => r.sha));
  return fraction(entries.filter((e) => e.bullet.cites.some((sha) => cited.has(sha))).length, entries.length);
}
interface PartA {
  mutations: { range: string; attempt: MutationAttempt; caught: boolean | null; reason: ReasonCode | null }[];
  falseDrops: { range: string; id: string; reason: ReasonCode | null; text: string; cites: string[] }[];
  genuineCount: number;
}
function partA(ranges: readonly RangeData[], seed: number): PartA {
  const random = seededRandom(seed);
  const out: PartA = { mutations: [], falseDrops: [], genuineCount: 0 };
  for (const range of ranges) {
    out.genuineCount += range.entries.length;
    const genuineVerdicts = validateAll(range.entries.map((e) => e.bullet), range.ctx);
    range.entries.forEach((entry, i) => {
      const verdict = genuineVerdicts[i]!;
      if (!verdict.kept) out.falseDrops.push({ range: range.id, id: entry.id, reason: verdict.reason, text: entry.bullet.text, cites: entry.bullet.cites });
      for (const operator of OPERATORS) {
        const attempt = mutate(operator, entry, range.entries, range.facts, range.unitBySha, random);
        // Mutations are evaluated independently: a planted bullet cannot be caught just by duplicating its source.
        const verdict = attempt.bullet === null ? null : validateBullet(attempt.bullet, range.ctx);
        out.mutations.push({ range: range.id, attempt, caught: verdict === null ? null : !verdict.kept, reason: verdict?.reason ?? null });
      }
    });
  }
  return out;
}

export interface LiveEvidence {
  authorized: true; model_id: string; config_version: string; price_version: string; price: ModelPrice;
  actual_usd: number; reserved_usd: number; latency_ms: number;
}
export type EvalRecordingEntry = RecordingEntry & { live?: LiveEvidence };
export interface EvalRecordingIndex extends Omit<RecordingIndex, 'recordings'> { recordings: EvalRecordingEntry[] }
interface Replayed {
  bullets: BulletInput[]; accepted: BulletInput[]; requestDrops: number; violations: number;
  model: string; price: string; hashes: string[]; cost: number;
}
async function replay(range: RangeData, mode: 'mock' | 'live'): Promise<Replayed | null> {
  const index = readJson<EvalRecordingIndex>(insideRoot('fixtures/recorded/INDEX.json'));
  const selected: RecordingIndex = { schema: 'recorded-index.v1', recordings: index.recordings.filter((e) =>
    e.provenance === (mode === 'mock' ? 'synthetic-authored' : 'live') && e.fixture === range.id) };
  const out: Replayed = { bullets: [], accepted: [], requestDrops: 0, violations: 0, model: mode === 'mock' ? 'synthetic-authored' : '', price: mode === 'mock' ? 'not applicable (mock)' : '', hashes: [], cost: 0 };
  const models = new Set<string>(); const prices = new Set<string>();
  for (const chunk of [...new Set(range.units.map((u) => u.chunk_index))].sort((a, b) => a - b)) {
    const units = unitsOfChunk(range.units, chunk);
    const prompt = buildPrompt(units);
    const hash = await promptHash(prompt.prompt);
    const request = { units, prompt: prompt.prompt, promptHash: hash, modelId: out.model, maxTokens: 4096 };
    const entry = findRecording(request, { index: selected, files: {}, fixture: range.id }) as EvalRecordingEntry | null;
    if (entry === null) return null; // no partial release is silently counted as a complete model run
    const file = readJson<RecordingFile>(insideRoot(`fixtures/recorded/${entry.file}`));
    if (mode === 'live') {
      const live = entry.live;
      if (!live || live.authorized !== true || !live.model_id || !/^[0-9a-f]{64}$/.test(live.config_version) ||
        !/^[0-9a-f]{64}$/.test(live.price_version) || !readPrices(JSON.stringify({ schema: 'prices.v1', models: { [live.model_id]: live.price } })) ||
        !file.usage || live.actual_usd !== costUsd(file.usage, live.price) || !Number.isFinite(live.reserved_usd) || live.reserved_usd < live.actual_usd) throw new Error('live recording lacks verified usage/price/authorization provenance');
      models.add(live.model_id); prices.add(`${live.price_version}@${live.price.as_of}`); out.cost += live.actual_usd;
    }
    const provider = createMockProvider({ index: selected, files: { [entry.file]: file }, fixture: range.id });
    const response = await provider.generate(request);
    if (response.status !== 'ok') throw new Error(`${range.id}: explicit replay miss`);
    const parsed = parseModelOutput(response.raw, allowedShasForPrompt(units));
    if (!parsed.ok) throw new Error(`${range.id}: recorded output malformed`);
    out.bullets.push(...parsed.bullets, ...parsed.outsideRequest.map((d) => d.bullet));
    out.accepted.push(...parsed.bullets);
    out.requestDrops += parsed.outsideRequest.length; out.violations += parsed.violations.length; out.hashes.push(hash);
  }
  if (out.hashes.length === 0) return null;
  if (mode === 'live') {
    if (models.size !== 1 || prices.size !== 1) throw new Error('one release mixes model or price versions; evaluate separately');
    out.model = [...models][0]!; out.price = [...prices][0]!;
  }
  return out;
}

interface Provenance { dataset: string; config: string; prompt: string; model: string; price: string; mode: string }
interface BRow {
  range: string; variant: string; provenance: Provenance; unrun: boolean;
  proposed: number; kept: BulletInput[]; reasons: Record<string, number>; cost: number | null; rangeData: RangeData;
}
async function partB(ranges: readonly RangeData[], config: string): Promise<BRow[]> {
  const rows: BRow[] = [];
  for (const range of ranges) {
    const provenance = { dataset: `${range.id}@${range.fingerprint}`, config, prompt: PROMPT_TEMPLATE_VERSION, model: 'none', price: 'not applicable', mode: 'deterministic' };
    const baseline = ruleBasedBullets(range.units, range.facts);
    rows.push({ range: range.id, variant: 'rule-based', provenance, unrun: false, proposed: baseline.length, kept: baseline, reasons: {}, cost: 0, rangeData: range });
    for (const mode of ['mock', 'live'] as const) {
      const output = await replay(range, mode);
      for (const variant of ['ungated', 'section-gate', 'validated'] as const) {
        const prov = { ...provenance, mode, model: output?.model ?? 'not yet measured', price: output?.price ?? 'not yet measured',
          prompt: `${PROMPT_TEMPLATE_VERSION}:${output?.hashes.join(',') ?? 'not yet measured'}` };
        const reasons: Record<string, number> = {};
        let kept: BulletInput[] = [];
        if (output !== null) {
          if (variant === 'ungated') kept = output.bullets;
          else if (variant === 'section-gate') {
            const gated = sectionGate(output.bullets, range.ctx); kept = gated.kept; reasons.section_ungrounded = gated.dropped.length;
          } else {
            const verdicts = validateAll(output.accepted, range.ctx);
            kept = output.accepted.filter((_b, i) => verdicts[i]!.kept);
            for (const verdict of verdicts) if (verdict.reason !== null) reasons[verdict.reason] = (reasons[verdict.reason] ?? 0) + 1;
            reasons.cite_out_of_range = (reasons.cite_out_of_range ?? 0) + output.requestDrops;
          }
          reasons.schema_violation = output.violations;
        }
        rows.push({ range: range.id, variant: `${variant}-${mode}`, provenance: prov, unrun: output === null,
          proposed: output === null ? 0 : output.bullets.length + output.violations, kept, reasons, cost: output?.cost ?? null, rangeData: range });
      }
    }
  }
  return rows;
}
export interface AuditLabel { id: string; label: 'supported' | 'partial' | 'unsupported' }
export interface AuditCase {
  id: string; kept: boolean; bullet: BulletInput;
  source: { range: string; repository: string; fingerprint: string; bullet_index: number };
  evidence: {
    cites: CiteResolution[];
    commits: { sha: string; subject: string; body: string; paths: string[]; active: boolean; revert_state: string }[];
    revert_chains: string[][];
  };
}
export interface AuditSample { schema: 'audit-sample.v1'; dataset: string; config: string; seed: number; cases: AuditCase[]; provenance: Provenance }
/** Freeze the exact claim and sanitized cited evidence, so labelling never depends on replay ordering or later files. */
export function makeAuditCase(range: RangeData, bullet: BulletInput, index: number, kept: boolean): AuditCase {
  const cites = bullet.cites.map((cite) => resolveCite(cite, { facts: range.facts }));
  const shas = new Set(cites.flatMap((cite) => cite.status === 'resolved' ? [cite.sha] : cite.status === 'ambiguous' ? cite.candidates : []));
  const chains = range.facts.revertChains.filter((chain) => chain.some((sha) => shas.has(sha)));
  for (const chain of chains) for (const sha of chain) shas.add(sha);
  return {
    id: `${range.id}:${index}:${digest(JSON.stringify(bullet))}`, kept,
    bullet: { text: bullet.text, category: bullet.category, cites: [...bullet.cites] },
    source: { range: range.id, repository: range.repository, fingerprint: range.fingerprint, bullet_index: index },
    evidence: { cites, commits: [...shas].sort().flatMap((sha) => {
      // Ambiguous prefixes can also name rejected/outside commits, whose text was never retained.
      const fact = range.facts.commits.get(sha);
      return fact === undefined ? [] : [{ sha, subject: fact.subject, body: fact.body, paths: [...fact.paths], active: fact.active, revert_state: fact.revertState }];
    }), revert_chains: chains.map((chain) => [...chain]) },
  };
}
export function auditCounts(items: readonly (AuditLabel & { kept: boolean })[]): { precision: Fraction; unsupportedDrop: Fraction; partial: number } {
  const kept = items.filter((x) => x.kept);
  const unsupported = items.filter((x) => x.label === 'unsupported');
  return { precision: fraction(kept.filter((x) => x.label === 'supported').length, kept.length),
    unsupportedDrop: fraction(unsupported.filter((x) => !x.kept).length, unsupported.length), partial: items.filter((x) => x.label === 'partial').length };
}

const NM = 'not yet measured';
function cell(value: unknown): string { return String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' '); }
function show(value: Fraction): string { return value.value === null ? `${NM} (0 denominator)` : `${value.numerator}/${value.denominator} (${(value.value * 100).toFixed(2)}%)`; }
function provenanceCells(p: Provenance): string { return [p.dataset, p.config, p.prompt, p.model, p.price, p.mode].map(cell).join(' | '); }
function table(headers: string[], rows: string[]): string { return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r} |`).join('\n')}\n`; }
const PROV = ['dataset version', 'config version', 'prompt version/hash', 'model', 'price version/date', 'provenance'];

function auditSection(sample: AuditSample, readLabels = false): string {
  const path = insideRoot('gold/audit.json');
  let result = NM;
  if (readLabels && existsSync(path)) {
    const packet = readJson<{ schema: string; dataset: string; config: string; labels: AuditLabel[] }>(path);
    if (packet.schema !== 'audit.v1' || packet.dataset !== sample.dataset || packet.config !== sample.config) throw new Error('audit dataset/config lineage mismatch');
    if (sample.cases.length === 60 && packet.labels.length === 60) {
      const byId = new Map(packet.labels.map((l) => [l.id, l.label]));
      if (byId.size !== 60 || sample.cases.some((s) => !['supported', 'partial', 'unsupported'].includes(byId.get(s.id) ?? ''))) throw new Error('audit must label the exact seeded live sample once');
      const measured = auditCounts(sample.cases.map((s) => ({ ...s, label: byId.get(s.id)! })));
      result = `kept precision ${show(measured.precision)}; unsupported dropped ${show(measured.unsupportedDrop)}; partial labels ${measured.partial}`;
    }
  }
  return table(['precision / unsupported dropped', ...PROV], [[result, provenanceCells(sample.provenance)].join(' | ')]) +
    '\nAudit needs 60 supported/partial/unsupported labels for this exact seeded live sample, tied to the recorded dataset and config. Partial is separate and is not counted as supported. `gold/audit.json` shape: `{schema:"audit.v1",dataset,config,labels:[{id,label}]}`. Each frozen case below includes its exact bullet, source identity, citation resolutions and sanitized commit messages/paths (plus related revert chains). Label source support, not truth. Dev evaluation may read dev labels; heldout evaluation never reads this file. After heldout completes, replace it with heldout labels and run `node scripts/eval.ts --split heldout --audit-only` to import them without reopening heldout artifacts or rerunning metrics.\n\n' +
    `\`\`\`json\n${JSON.stringify(sample, null, 2)}\n\`\`\`\n\nJev: not built, unmeasured. Live injection outcome: not yet measured.\n`;
}

async function report(ranges: RangeData[], split: string, seed: number, config: string, manifest: GoldManifest, dataset: string): Promise<string> {
  const a = partA(ranges, seed); const b = await partB(ranges, config);
  const prov: Provenance = { dataset, config, prompt: `${PROMPT_TEMPLATE_VERSION} (no model)`, model: 'none', price: 'not applicable', mode: 'keyless/deterministic' };
  let text = `# Evaluation results\n\nSplit: ${split}; mutation seed: ${seed}. Gold target ${manifest.target_status === 'met' ? 'met' : 'unmet'}: ${manifest.qualified_ranges} ranges / ${manifest.qualified_repositories} repositories (required 20 / 8).\n\n`;
  text += 'Results describe traceability to commit text, not truth. Synthetic entries are a small authored proxy; human-note false drops are also a proxy. Recall measures agreement with listed changes, not correctness. No paid self-review comparison or Jev result exists. Deterministic/mock zero costs do not estimate live cost.\n\n';
  text += '## A. Planted mutations (no model)\n\n';
  text += table(['operator', 'caught / eligible (micro)', 'primary reason correct / eligible', 'skipped / attempted', 'proposed target', 'outcome', ...PROV], OPERATORS.map((operator) => {
    const all = a.mutations.filter((m) => m.attempt.operator === operator);
    const eligible = all.filter((m) => m.attempt.eligible);
    const catchRate = fraction(eligible.filter((m) => m.caught).length, eligible.length);
    const target = eligible[0]?.attempt.target ?? all[0]?.attempt.target ?? null;
    const reasonCases = eligible.filter((m) => m.attempt.expectedReason !== null);
    const reasons = fraction(reasonCases.filter((m) => m.reason === m.attempt.expectedReason).length, reasonCases.length);
    return [operator, show(catchRate), reasonCases.length === 0 ? 'report-only / no primary target' : show(reasons), `${all.length - eligible.length}/${all.length}`,
      target === null ? 'report-only' : `${target * 100}%${operator === 'inflate_breaking' ? ' only under recorded precondition' : ''}`,
      target === null ? 'report-only' : catchRate.value === null ? NM : catchRate.value >= target ? 'meets proposed bar' : 'below proposed bar', provenanceCells(prov)].join(' | ');
  }));
  const falseRate = fraction(a.falseDrops.length, a.genuineCount);
  text += '\n' + table(['proxy', 'false drops / genuine (micro)', 'proposed <=15%', ...PROV], [[split === 'synthetic' ? 'authored synthetic entries' : 'human release-note entries', show(falseRate), falseRate.value === null ? NM : falseRate.value <= 0.15 ? 'meets proposed bar' : 'below proposed bar', provenanceCells(prov)].join(' | ')]);
  text += `\nEvery false drop (range/id, primary reason, text, cites):\n\n\`\`\`json\n${JSON.stringify(a.falseDrops, null, 2)}\n\`\`\`\n\nMutation preconditions, skipped cases, actual primary reasons and missed fabrications (caught=false) are all listed here; report-only operators imply no semantic-accuracy promise:\n\n\`\`\`json\n${JSON.stringify(a.mutations, null, 2)}\n\`\`\`\n\n`;
  text += '## B. End to end and comparators\n\nAll three model comparisons use the same raw replay. Schema violations count as dropped in every model row; request-boundary drops apply only to the validated row. No release with a missing chunk recording is measured. Typed/untyped refers to mapped entry evidence, not the repository label.\n\n';
  text += table(['range / variant', 'proposed', 'kept', 'dropped by primary reason', 'entry recall', 'typed recall', 'untyped recall', 'uncovered typed / untyped; feat / fix', 'kept per release / human count', 'USD per release', ...PROV], b.map((row) => {
    if (row.unrun) return [`${row.range} / ${row.variant}`, ...Array.from({ length: 9 }, () => NM), provenanceCells(row.provenance)].join(' | ');
    const range = row.rangeData;
    const typed = range.entries.filter((e) => e.bullet.cites.some((s) => range.facts.commits.get(s)?.typed));
    const untyped = range.entries.filter((e) => !typed.includes(e));
    const cited = new Set(row.kept.flatMap((bullet) => bullet.cites.map((cite) => resolveCite(cite, { facts: range.facts }))).filter((r) => r.status === 'resolved').map((r) => r.sha));
    const uncovered = uncoveredUnits(range.units, cited);
    return [`${row.range} / ${row.variant}`, row.proposed, row.kept.length, cell(JSON.stringify(row.reasons)), show(recall(range.entries, row.kept, range.facts)),
      show(recall(typed, row.kept, range.facts)), show(recall(untyped, row.kept, range.facts)),
      `${uncovered.typed.length}/${uncovered.untyped.length}; ${uncovered.typed.filter((u) => u.type === 'feat').length}/${uncovered.typed.filter((u) => u.type === 'fix').length}`,
      `${row.kept.length}/${range.entries.length}`, row.cost === null ? NM : row.cost.toFixed(6), provenanceCells(row.provenance)].join(' | ');
  }));
  text += '\nRecall retention and cost proposals use only complete, paired releases, with micro entry denominators (never averages of per-release percentages):\n\n';
  text += table(['comparison', 'ungated recall', 'validated recall', 'loss <=5 points', 'total USD / releases', 'gold under $5', ...PROV], (['mock', 'live'] as const).map((mode) => {
    const pairs = b.filter((r) => r.variant === `validated-${mode}` && !r.unrun).map((validated) => ({ validated, ungated: b.find((r) => r.range === validated.range && r.variant === `ungated-${mode}`)! }));
    const ungated = micro(pairs.map((p) => recall(p.ungated.rangeData.entries, p.ungated.kept, p.ungated.rangeData.facts)));
    const validated = micro(pairs.map((p) => recall(p.validated.rangeData.entries, p.validated.kept, p.validated.rangeData.facts)));
    const total = pairs.reduce((n, p) => n + (p.validated.cost ?? 0), 0);
    const completeGold = split !== 'synthetic' && manifest.target_status === 'met' && pairs.length === ranges.length && ranges.length > 0;
    const versions = { ...prov, prompt: [...new Set(pairs.map((p) => p.validated.provenance.prompt))].join(',') || NM,
      model: [...new Set(pairs.map((p) => p.validated.provenance.model))].join(',') || NM,
      price: [...new Set(pairs.map((p) => p.validated.provenance.price))].join(',') || NM, mode };
    return [mode, show(ungated), show(validated), ungated.value === null || validated.value === null ? NM : ungated.value - validated.value <= 0.05 ? 'meets proposed bar' : 'below proposed bar',
      pairs.length === 0 ? NM : `${total.toFixed(6)} / ${pairs.length}`, mode === 'live' && completeGold ? (total < 5 ? 'meets proposed bar (this split only)' : 'below proposed bar') : NM, provenanceCells(versions)].join(' | ');
  }));
  text += '\nThe $0.10 per 200-commit release cost proposal is not normalized from smaller releases; inspect actual complete live release costs above. Full-gold cost requires both frozen splits, so a split-only result is partial evidence.\n\n## C. Human audit\n\n';
  const cases: { range: RangeData; bullet: BulletInput; index: number; kept: boolean }[] = [];
  if (split !== 'synthetic') {
    for (const row of b.filter((r) => r.variant === 'ungated-live' && !r.unrun)) {
      const validated = b.find((r) => r.range === row.range && r.variant === 'validated-live')!;
      row.kept.forEach((bullet, i) => {
        cases.push({ range: row.rangeData, bullet, index: i, kept: validated.kept.includes(bullet) });
      });
    }
    const random = seededRandom((seed ^ 0x290c) >>> 0);
    for (let i = cases.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cases[i], cases[j]] = [cases[j]!, cases[i]!]; }
  }
  const liveRows = b.filter((r) => r.variant === 'validated-live' && !r.unrun);
  // Copy retained evidence only for the selected 60 cases, rather than for every replayed bullet.
  const sample: AuditSample = { schema: 'audit-sample.v1', dataset, config, seed,
    cases: cases.slice(0, 60).map((entry) => makeAuditCase(entry.range, entry.bullet, entry.index, entry.kept)), provenance: { ...prov,
    prompt: [...new Set(liveRows.map((r) => r.provenance.prompt))].join(',') || NM,
    model: [...new Set(liveRows.map((r) => r.provenance.model))].join(',') || NM,
    price: [...new Set(liveRows.map((r) => r.provenance.price))].join(',') || NM, mode: liveRows.length === 0 ? 'unrun' : 'human labels + live replay' } };
  if (split !== 'synthetic') writeFileSync(insideRoot(`gold/audit-sample-${split}.json`), `${JSON.stringify(sample, null, 2)}\n`);
  // A dev label packet may remain on disk. It must never fail or consume the once-only heldout evaluation.
  text += auditSection(sample, split === 'dev');
  return text;
}

export interface DevFreeze { schema: 'dev-freeze.v1'; manifest: string; config: string; seed: number; dev_dataset: string }
export function assertHeldoutFrozen(freeze: DevFreeze, manifest: string, config: string, seed: number): void {
  if (freeze.schema !== 'dev-freeze.v1' || freeze.manifest !== manifest || freeze.config !== config || freeze.seed !== seed || !/^[0-9a-f]{64}$/.test(freeze.dev_dataset)) throw new Error('heldout requires unchanged dev-frozen manifest, configuration and mutation seed');
}
/** Atomic exclusive creation consumes heldout even on later failure; never automatically removes the marker. */
export function reserveHeldout(marker: string, freeze: DevFreeze): void {
  writeFileSync(marker, `${JSON.stringify({ schema: 'heldout-once.v1', status: 'reserved', freeze }, null, 2)}\n`, { flag: 'wx' });
}
export async function main(argv: string[]): Promise<void> {
  let split = ''; let seed = GOLD_SEED; let freezeDev = false; let heldoutOnce = false; let auditOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--split') split = argv[++i] ?? '';
    else if (arg === '--seed') seed = Number(argv[++i]);
    else if (arg === '--freeze-dev') freezeDev = true;
    else if (arg === '--heldout-once') heldoutOnce = true;
    else if (arg === '--audit-only') auditOnly = true;
    else throw new Error('usage: --split synthetic|dev|heldout [--seed uint32] [--freeze-dev|--heldout-once], or --split heldout --audit-only');
  }
  seededRandom(seed);
  if (auditOnly) {
    if (split !== 'heldout' || freezeDev || heldoutOnce) throw new Error('--audit-only is a heldout label import, not another evaluation');
    const marker = readJson<{ status: string; config: string; dataset: string; report_sha256: string; audit_sample_sha256: string }>(insideRoot('gold/heldout-once.json'));
    const reportPath = insideRoot('docs/results-heldout.md'); const original = readText(reportPath);
    const sampleText = readText(insideRoot('gold/audit-sample-heldout.json')); const sample = JSON.parse(sampleText) as AuditSample;
    if (marker.status !== 'complete' || digest(original) !== marker.report_sha256 || digest(sampleText) !== marker.audit_sample_sha256 || marker.config !== sample.config || marker.dataset !== sample.dataset || sample.schema !== 'audit-sample.v1') throw new Error('audit snapshot/report does not match once-only heldout receipt');
    const start = original.indexOf('## C. Human audit\n\n');
    if (start < 0) throw new Error('missing audit section');
    const updated = original.slice(0, start) + '## C. Human audit\n\n' + auditSection(sample, true);
    writeFileSync(reportPath, updated); writeFileSync(insideRoot('docs/results.md'), updated);
    writeFileSync(insideRoot('gold/heldout-once.json'), `${JSON.stringify({ ...marker, report_sha256: digest(updated) }, null, 2)}\n`);
    return;
  }
  if (!['synthetic', 'dev', 'heldout'].includes(split) || (freezeDev && split !== 'dev') || (heldoutOnce && split !== 'heldout') || (split === 'heldout' && !heldoutOnce)) throw new Error('invalid split/freeze/heldout flag combination');
  const manifestText = readText(insideRoot('gold/manifest.json'));
  const manifest = JSON.parse(manifestText) as GoldManifest;
  assertSplitIsolation(manifest);
  const config = await configVersion();
  const freezePath = insideRoot('gold/dev-freeze.json');
  const marker = insideRoot('gold/heldout-once.json');
  if (split === 'heldout') {
    if (manifest.frozen_on === null) throw new Error('gold must be frozen before heldout');
    const freeze = readJson<DevFreeze>(freezePath);
    assertHeldoutFrozen(freeze, digest(manifestText), config, seed);
    reserveHeldout(marker, freeze); // before opening any heldout log or entry file
  }
  if (split === 'dev' && existsSync(marker)) throw new Error('heldout already consumed: dev tuning is closed');
  const ranges = split === 'synthetic' ? loadSynthetic() : loadGold(manifest, split as GoldSplit);
  const dataset = digest(JSON.stringify(ranges.map((r) => [r.id, r.fingerprint])));
  const result = await report(ranges, split, seed, config, manifest, dataset);
  if (freezeDev) {
    if (ranges.length === 0 || manifest.frozen_on === null) throw new Error('cannot freeze an empty/unfrozen dev set');
    writeFileSync(freezePath, `${JSON.stringify({ schema: 'dev-freeze.v1', manifest: digest(manifestText), config, seed, dev_dataset: dataset } satisfies DevFreeze, null, 2)}\n`, { flag: 'wx' });
  }
  writeFileSync(insideRoot('docs/results.md'), result);
  // Preserve each split's report instead of losing dev evidence when heldout is written.
  writeFileSync(insideRoot(`docs/results-${split}.md`), result);
  if (split === 'heldout') writeFileSync(marker, `${JSON.stringify({ schema: 'heldout-once.v1', status: 'complete', dataset, config,
    report_sha256: digest(result), audit_sample_sha256: digest(readText(insideRoot('gold/audit-sample-heldout.json'))) }, null, 2)}\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`Evaluation refused: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
}
