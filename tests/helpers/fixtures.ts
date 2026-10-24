// Test helpers: load the synthetic fixtures, traps.json and recordings, and run the deterministic pipeline
// parse -> facts -> units -> chunks. Not a test file (vitest only collects *.test.ts).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RecordingFile, RecordingIndex } from '../../supabase/functions/_shared/core/providers/mock.ts';
import type { WireUnit } from '../../supabase/functions/_shared/core/units-wire.ts';
import { chunkUnits } from '../../src/core/gitfacts/chunk.ts';
import { buildFacts } from '../../src/core/gitfacts/facts.ts';
import type { FactIndex } from '../../src/core/gitfacts/facts.ts';
import { groupUnits } from '../../src/core/gitfacts/units.ts';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import type { SanitizedLog } from '../../src/core/gitlog/schema.ts';
import { validatorContext } from '../../src/core/validate/validate.ts';
import type { ValidatorContext } from '../../src/core/validate/validate.ts';
import type { BulletInput, ReasonCode, WarningCode } from '../../src/core/validate/reasons.ts';

export const FIXTURE_IDS = ['synthetic-small', 'synthetic-traps', 'synthetic-untyped'] as const;
export type FixtureId = (typeof FIXTURE_IDS)[number];

const root = (relative: string): string => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

export function readText(relative: string): string {
  return readFileSync(root(relative), 'utf8');
}

export function readJson<T>(relative: string): T {
  return JSON.parse(readText(relative)) as T;
}

export function fixtureText(id: FixtureId): string {
  return readText(`fixtures/gitlog/${id}.gitlog.v1.json`);
}

export function parseOk(text: string): SanitizedLog {
  const result = parseLog(text);
  if (!result.ok) throw new Error(`fixture failed to parse: ${result.report.fileError?.code}`);
  return result.log;
}

export interface Pipeline {
  log: SanitizedLog;
  facts: FactIndex;
  units: WireUnit[];
  chunkCount: number;
  possibleDuplicates: ReadonlySet<string>;
  ctx: ValidatorContext;
}

export function pipelineFromLog(log: SanitizedLog): Pipeline {
  const facts = buildFacts(log);
  const grouped = groupUnits(facts);
  if (!grouped.ok) throw new Error(`grouping failed: ${grouped.code}`);
  const chunked = chunkUnits(grouped.units);
  if (!chunked.ok) throw new Error(`chunking failed: ${chunked.code}`);
  const possibleDuplicateShas = new Set(
    chunked.units.filter((u) => grouped.possibleDuplicates.has(u.unit_key)).flatMap((u) => u.shas),
  );
  return {
    log,
    facts,
    units: chunked.units,
    chunkCount: chunked.chunkCount,
    possibleDuplicates: grouped.possibleDuplicates,
    ctx: validatorContext(facts, { possibleDuplicateShas }),
  };
}

export function pipeline(id: FixtureId): Pipeline {
  return pipelineFromLog(parseOk(fixtureText(id)));
}

// ---- traps.json ----

export type TrapExpectation =
  | { kind: 'unit'; unit_key: string; shas: string[]; pr_number?: number | null; type?: string; breaking?: boolean; noise_reason?: string | null; revert_state?: string }
  | { kind: 'commit'; sha: string; revert_state?: string; issue_refs?: number[] }
  | { kind: 'reject'; sha: string; code: string }
  | { kind: 'possible_duplicate'; unit_keys: string[] }
  | { kind: 'revert_issue'; sha: string; issue: string }
  | { kind: 'uncovered'; unit_key: string; eligible: boolean }
  | { kind: 'units_count'; count: number; chunk_count: number }
  | {
      kind: 'verdict';
      stage: 'validator' | 'request';
      bullet: BulletInput;
      kept: boolean;
      reason: ReasonCode | null;
      warnings?: WarningCode[];
      rejected_code?: string;
      basis?: string;
    };

export interface Trap {
  id: string;
  description: string;
  fixture: FixtureId | null;
  inline?: unknown;
  shas: string[];
  expect: TrapExpectation[];
}

export interface TrapsFile {
  schema: 'traps.v1';
  phantom_sha: string;
  traps: Trap[];
}

export function traps(): TrapsFile {
  return readJson<TrapsFile>('fixtures/gitlog/traps.json');
}

// ---- recordings ----

export interface Annotation {
  index: number;
  trap: string | null;
  expect: { stage: 'validator' | 'request'; kept: boolean; reason: ReasonCode | null; warnings: WarningCode[] };
}

export type AnnotatedRecording = RecordingFile & { annotations: Annotation[] };

export function recordingIndex(): RecordingIndex {
  return readJson<RecordingIndex>('fixtures/recorded/INDEX.json');
}

export function recordingFiles(): Record<string, AnnotatedRecording> {
  const files: Record<string, AnnotatedRecording> = {};
  for (const entry of recordingIndex().recordings) files[entry.file] = readJson<AnnotatedRecording>(`fixtures/recorded/${entry.file}`);
  return files;
}
