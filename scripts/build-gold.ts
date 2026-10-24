// Builder-only. Never imported by the application or keyless evaluator. No repositories qualify by default.
// Local exported gitlogs + reviewed handwritten PR-note entries are the input; optional GitHub metadata checks
// use public API endpoints only. --verify-github may use GITHUB_TOKEN, but needs no token for public repositories.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseLog } from '../src/core/gitlog/parse.ts';
import { buildFacts } from '../src/core/gitfacts/facts.ts';
import { groupUnits } from '../src/core/gitfacts/units.ts';
import { isCategory } from '../supabase/functions/_shared/core/output-schema.ts';
import { redactEmails, createRedactionCounts } from '../src/core/gitlog/redact.ts';
import { assertSplitIsolation, digest, GOLD_SEED, insideRoot, makeRange, readJson, readText, repositorySplits } from './eval.ts';
import type { GoldManifest, GoldRange, Screening } from './eval.ts';
import type { GenuineEntry } from './mutate.ts';

export interface Candidate {
  id: string; repository: string; public: boolean; from_ref: string; to_ref: string; gitlog: string;
  license: string; license_url: string; retrieved_on: string; notes_url: string;
  notes_kind: 'handwritten' | 'human-changeset' | 'mechanically-generated' | 'unknown';
  notes_reviewed: boolean; screening_reason: string;
  entries: { id: string; text: string; category: string; pr_number: number }[];
}
const PERMISSIVE = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'];
export function screen(candidate: Candidate): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(candidate.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate.repository)) return 'invalid range id or repository';
  if (candidate.public !== true) return 'private or unverified public status';
  if (!PERMISSIVE.includes(candidate.license)) return 'license not on MIT/Apache-2.0/BSD allowlist';
  if (!candidate.notes_reviewed || !candidate.screening_reason?.trim()) return 'handwritten-note provenance review missing';
  if (!['handwritten', 'human-changeset'].includes(candidate.notes_kind)) return 'mechanical/unknown note provenance excluded';
  if (!/^https:\/\//.test(candidate.license_url) || !/^https:\/\//.test(candidate.notes_url)) return 'missing license or note evidence URL';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.retrieved_on)) return 'retrieval date missing';
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return 'no handwritten entries mapped to PR numbers';
  return null;
}

async function githubCheck(candidate: Candidate, token: string | undefined): Promise<string | null> {
  const get = async (suffix: string): Promise<Record<string, unknown>> => {
    const response = await fetch(`https://api.github.com/repos/${candidate.repository}${suffix}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub metadata HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  };
  const repo = await get('');
  if (repo.private !== false) return 'GitHub did not verify a public repository';
  const license = await get('/license');
  const spdx = (license.license as { spdx_id?: unknown } | undefined)?.spdx_id;
  if (spdx !== candidate.license) return 'GitHub license differs from reviewed license';
  const release = await get(`/releases/tags/${encodeURIComponent(candidate.to_ref)}`);
  if (release.draft !== false || typeof release.body !== 'string' || release.body.trim() === '') return 'release notes unavailable';
  // This checks note/PR presence, never authorship. Human provenance screening is still required separately.
  if (candidate.entries.some((entry) => !(release.body as string).includes(`#${entry.pr_number}`))) return 'a mapped PR is absent from GitHub release text';
  return null;
}

export function prepareCandidate(candidate: Candidate): { log: string; entries: GenuineEntry[] } {
  const parsed = parseLog(readText(insideRoot(candidate.gitlog)));
  if (!parsed.ok || parsed.report.rejected > 0) throw new Error('gitlog refused or has rejected records; no silent omission');
  const log = parsed.log;
  if (log.repo_label.toLowerCase() !== candidate.repository.toLowerCase() || log.from_ref !== candidate.from_ref || log.to_ref !== candidate.to_ref) throw new Error('gitlog repository/range does not match screening');
  const facts = buildFacts(log);
  const grouped = groupUnits(facts);
  if (!grouped.ok) throw new Error(grouped.code);
  const ids = new Set<string>();
  const entries = candidate.entries.map((entry): GenuineEntry => {
    if (!entry.id || ids.has(entry.id) || !entry.text?.trim() || !isCategory(entry.category) || !Number.isSafeInteger(entry.pr_number) || entry.pr_number <= 0) throw new Error('invalid note entry/category/PR mapping');
    ids.add(entry.id);
    const units = grouped.units.filter((u) => u.pr_number === entry.pr_number);
    const cites = [...new Set(units.flatMap((u) => u.shas))].sort();
    if (cites.length === 0) throw new Error(`no in-range PR unit for entry ${entry.id}`);
    const counts = createRedactionCounts();
    const text = redactEmails(entry.text, counts);
    if (counts.email > 0) throw new Error('note entry contains email-like text; review sanitized note before inclusion');
    return { id: entry.id, pr_number: entry.pr_number, bullet: { text, category: entry.category, cites } };
  });
  const output = `${JSON.stringify({ schema: log.schema, repo_label: log.repo_label, from_ref: log.from_ref, to_ref: log.to_ref,
    ...(log.base_url === null ? {} : { base_url: log.base_url }), commits: log.commits, outside_shas: log.outside_shas }, null, 2)}\n`;
  makeRange(candidate.id, candidate.repository, output, entries); // shared parser/facts/limits; no duplicate validator
  return { log: output, entries };
}

async function main(argv: string[]): Promise<void> {
  let input = ''; let freeze = ''; let verifyGithub = false; let seed = GOLD_SEED;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidates') input = argv[++i] ?? '';
    else if (argv[i] === '--freeze') freeze = argv[++i] ?? '';
    else if (argv[i] === '--seed') seed = Number(argv[++i]);
    else if (argv[i] === '--verify-github') verifyGithub = true;
    else throw new Error('usage: --candidates <local-json> --freeze YYYY-MM-DD [--seed uint32] [--verify-github]');
  }
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(freeze) || new Date(`${freeze}T00:00:00Z`).toISOString().slice(0, 10) !== freeze) throw new Error('candidate file and valid freeze date required');
  const current = readJson<GoldManifest>(insideRoot('gold/manifest.json'));
  if (current.frozen_on !== null || current.ranges.length > 0 || existsSync(insideRoot('gold/dev-freeze.json')) || existsSync(insideRoot('gold/heldout-once.json'))) throw new Error('gold is already frozen/populated; never overwrite evaluation history');
  const packet = readJson<{ schema: string; candidates: Candidate[] }>(insideRoot(input));
  if (packet.schema !== 'gold-candidates.v1' || !Array.isArray(packet.candidates)) throw new Error('bad candidate packet');
  const screening: Screening[] = [];
  const qualified: { candidate: Candidate; log: string; entries: GenuineEntry[] }[] = [];
  const ids = new Set<string>();
  for (const candidate of packet.candidates) {
    let reason = screen(candidate);
    if (ids.has(candidate.id)) reason = 'duplicate candidate id';
    ids.add(candidate.id);
    if (reason === null && verifyGithub) {
      try { reason = await githubCheck(candidate, process.env.GITHUB_TOKEN); }
      catch (error: unknown) { reason = error instanceof Error ? error.message : 'GitHub metadata unavailable'; }
    }
    if (reason === null) {
      try { qualified.push({ candidate, ...prepareCandidate(candidate) }); }
      catch (error: unknown) { reason = error instanceof Error ? error.message : 'local mapping failed'; }
    }
    screening.push({ id: candidate.id, repository: candidate.repository.toLowerCase(), included: reason === null,
      reason: reason ?? candidate.screening_reason, license: candidate.license, notes_kind: candidate.notes_kind,
      notes_url: candidate.notes_url, license_url: candidate.license_url, retrieved_on: candidate.retrieved_on });
  }
  const splits = repositorySplits(qualified.map((q) => q.candidate.repository.toLowerCase()), seed);
  const artifacts: { path: string; text: string }[] = [];
  const ranges: GoldRange[] = qualified.map(({ candidate, log, entries }) => {
    const entriesText = `${JSON.stringify(entries, null, 2)}\n`;
    const gitlog = `gold/ranges/${candidate.id}.gitlog.v1.json`; const entryPath = `gold/ranges/${candidate.id}.entries.json`;
    artifacts.push({ path: gitlog, text: log }, { path: entryPath, text: entriesText });
    return { id: candidate.id, repository: candidate.repository.toLowerCase(), split: splits.get(candidate.repository.toLowerCase())!,
      from_ref: candidate.from_ref, to_ref: candidate.to_ref, gitlog, gitlog_sha256: digest(log), entries: entryPath, entries_sha256: digest(entriesText) };
  });
  const manifest: GoldManifest = { schema: 'gold-manifest.v1', seed, frozen_on: freeze, target: { ranges: 20, repositories: 8 },
    qualified_ranges: ranges.length, qualified_repositories: splits.size, target_status: ranges.length >= 20 && splits.size >= 8 ? 'met' : 'unmet', screening, ranges };
  assertSplitIsolation(manifest);
  for (const artifact of artifacts) if (existsSync(insideRoot(artifact.path))) throw new Error('gold artifact already exists; refusing replacement');
  mkdirSync(insideRoot('gold/ranges'), { recursive: true });
  for (const artifact of artifacts) writeFileSync(insideRoot(artifact.path), artifact.text, { flag: 'wx' });
  writeFileSync(insideRoot('gold/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(insideRoot('gold/ATTRIBUTION.md'), '# Gold attribution\n\n' +
    `Frozen ${freeze}; repository split seed ${seed}. Target remains 20 ranges / at least 8 repositories. Qualified ${ranges.length} / ${splits.size}; target ${manifest.target_status}.\n\n` +
    'Notes must be handwritten with PR numbers; human-written changesets collated by a bot need provenance review. Mechanical commit-message changelogs are excluded. GitHub checks verify public metadata/PR presence only, never handwritten authorship. No author data is retained.\n\n' +
    screening.map((s) => `- ${s.id}: ${s.included ? 'included' : 'excluded'}; ${s.repository}; ${s.license}; ${s.retrieved_on}; notes ${s.notes_url}; license ${s.license_url}; reason: ${s.reason}`).join('\n') + '\n');
  process.stdout.write(`gold target ${manifest.target_status}: ${ranges.length} ranges / ${splits.size} repos; required 20 / 8. Partial evidence is allowed with this flag; target is never reduced.\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`Gold build refused: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
}
