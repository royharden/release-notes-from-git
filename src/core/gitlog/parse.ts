// parseLog: gitlog.v1 text -> SanitizedLog + ParseReport. File-level limits refuse the upload; record-level
// faults reject only that record (stable code + index, sha kept when well-formed). Nothing is truncated.

import { LIMITS, codePointLength } from '../../../supabase/functions/_shared/core/limits.ts';
import { FULL_SHA, GITLOG_SCHEMA, ISO_DATE_TIME } from './schema.ts';
import type {
  FileErrorCode,
  ParseResult,
  RejectCode,
  RejectedRecord,
  SanitizedCommit,
  SanitizedFile,
  SanitizedLog,
} from './schema.ts';
import { createRedactionCounts, isAuthorLikeKey, redactBaseUrl, redactEmails, redactMessage } from './redact.ts';
import type { RedactionCounts } from './redact.ts';
import { buildReport } from './report.ts';

const HEADER_FIELDS = new Set(['schema', 'repo_label', 'from_ref', 'to_ref', 'base_url', 'commits', 'outside_shas']);
const COMMIT_FIELDS = new Set(['sha', 'parents', 'date', 'subject', 'body', 'files']);
const FILE_FIELDS = new Set(['path', 'added', 'deleted']);

type JsonRecord = Record<string, unknown>;

export function parseLog(text: string): ParseResult {
  const redactions = createRedactionCounts();
  const fail = (code: FileErrorCode, detail: string): ParseResult => ({
    ok: false,
    report: buildReport({ accepted: 0, rejected: [], redactions, droppedFields: 0, outsideShas: 0, fileError: { code, detail } }),
  });

  // UTF-8 never takes fewer bytes than UTF-16 code units, so an over-long string is refused without encoding it.
  if (text.length > LIMITS.maxFileBytes) return fail('too_large', `more than ${LIMITS.maxFileBytes} bytes`);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.maxFileBytes) return fail('too_large', `${bytes} bytes exceeds ${LIMITS.maxFileBytes}`);

  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail('not_json', 'the file is not valid JSON');
  }
  if (!isRecord(data)) return fail('bad_schema', 'the top level must be an object');
  if (data.schema !== GITLOG_SCHEMA) return fail('bad_schema', `schema must be "${GITLOG_SCHEMA}"`);

  const header = readHeader(data);
  if (typeof header === 'string') return fail('bad_header', header);
  const commitsRaw = data.commits;
  if (!Array.isArray(commitsRaw)) return fail('bad_schema', 'commits must be an array');
  if (commitsRaw.length > LIMITS.maxCommits) {
    return fail('too_many_commits', `${commitsRaw.length} commits exceeds ${LIMITS.maxCommits}`);
  }

  let droppedFields = 0;
  for (const key of Object.keys(data)) {
    if (HEADER_FIELDS.has(key)) continue;
    if (isAuthorLikeKey(key)) redactions.author_field++;
    else droppedFields++;
  }

  // Pass 1: per-record structure. Pass 2: duplicate shas reject every record carrying them.
  const candidates: { index: number; record: JsonRecord }[] = [];
  const rejected: RejectedRecord[] = [];
  const shaCounts = new Map<string, number>();
  commitsRaw.forEach((raw: unknown, index: number) => {
    const sha = isRecord(raw) ? wellFormedSha(raw.sha) : null;
    if (sha !== null) shaCounts.set(sha, (shaCounts.get(sha) ?? 0) + 1);
    const code = checkRecord(raw);
    if (code === null) candidates.push({ index, record: raw as JsonRecord });
    else rejected.push(sha === null ? { index, code } : { index, sha, code });
  });

  const commits: SanitizedCommit[] = [];
  for (const { index, record } of candidates) {
    const sha = wellFormedSha(record.sha) as string;
    if ((shaCounts.get(sha) ?? 0) > 1) {
      rejected.push({ index, sha, code: 'duplicate_sha' });
      continue;
    }
    for (const key of Object.keys(record)) {
      if (COMMIT_FIELDS.has(key)) continue;
      if (isAuthorLikeKey(key)) redactions.author_field++;
      else droppedFields++;
    }
    commits.push(sanitizeCommit(record, sha, redactions));
  }
  rejected.sort((a, b) => a.index - b.index);

  const outside = readOutsideShas(data.outside_shas, shaCounts);
  if (typeof outside === 'string') return fail(outside, outsideDetail(outside));

  const log: SanitizedLog = {
    schema: GITLOG_SCHEMA,
    repo_label: redactEmails(header.repo_label, redactions),
    from_ref: redactEmails(header.from_ref, redactions),
    to_ref: redactEmails(header.to_ref, redactions),
    base_url: header.base_url === null ? null : redactBaseUrl(header.base_url, redactions),
    commits,
    outside_shas: outside.shas,
    rejected,
  };
  const report = buildReport({
    accepted: commits.length,
    rejected,
    redactions,
    droppedFields,
    outsideShas: outside.shas.length,
    fileError: null,
  });
  return { ok: true, log, report };
}

interface Header {
  repo_label: string;
  from_ref: string;
  to_ref: string;
  base_url: string | null;
}

function readHeader(data: JsonRecord): Header | string {
  const { repo_label, from_ref, to_ref, base_url } = data;
  if (!isBoundedString(repo_label, LIMITS.maxLabelChars)) return `repo_label must be a string of at most ${LIMITS.maxLabelChars} chars`;
  if (!isBoundedString(from_ref, LIMITS.maxRefChars) || from_ref === '') return 'from_ref must be a non-empty string';
  if (!isBoundedString(to_ref, LIMITS.maxRefChars) || to_ref === '') return 'to_ref must be a non-empty string';
  if (base_url !== undefined && base_url !== null && typeof base_url !== 'string') return 'base_url must be a string or null';
  return { repo_label, from_ref, to_ref, base_url: typeof base_url === 'string' && base_url.trim() !== '' ? base_url.trim() : null };
}

/** First failing record-level check, or null when the record is acceptable. Order matches REJECT_CODES. */
function checkRecord(raw: unknown): RejectCode | null {
  if (!isRecord(raw)) return 'not_object';
  const sha = wellFormedSha(raw.sha);
  if (sha === null) return 'bad_sha';
  const parents = raw.parents;
  if (!Array.isArray(parents)) return 'bad_parents';
  const parentShas = parents.map(wellFormedSha);
  if (parentShas.some((p) => p === null || p === sha) || new Set(parentShas).size !== parentShas.length) return 'bad_parents';
  if (typeof raw.date !== 'string' || !ISO_DATE_TIME.test(raw.date) || !Number.isFinite(Date.parse(raw.date))) return 'bad_date';
  if (typeof raw.subject !== 'string') return 'bad_subject';
  if (typeof raw.body !== 'string') return 'bad_body';
  if (codePointLength(raw.body) > LIMITS.maxBodyChars) return 'body_too_long';
  const files = raw.files;
  if (!Array.isArray(files)) return 'bad_files';
  if (files.length > LIMITS.maxFilesPerCommit) return 'too_many_files';
  for (const file of files as unknown[]) {
    if (!isRecord(file) || typeof file.path !== 'string' || file.path === '' || file.path.includes('\u0000')) return 'bad_file';
  }
  for (const file of files as JsonRecord[]) {
    if (!isCount(file.added) || !isCount(file.deleted)) return 'bad_counts';
  }
  return null;
}

function sanitizeCommit(record: JsonRecord, sha: string, redactions: RedactionCounts): SanitizedCommit {
  const files: SanitizedFile[] = (record.files as JsonRecord[]).map((file) => ({
    path: redactEmails(file.path as string, redactions),
    added: file.added as number | null,
    deleted: file.deleted as number | null,
  }));
  return {
    sha,
    parents: (record.parents as unknown[]).map((p) => wellFormedSha(p) as string),
    date: record.date as string,
    // Trailer stripping is for bodies only: a subject such as "Author: ..." would otherwise become empty.
    subject: redactEmails(record.subject as string, redactions),
    body: redactMessage(record.body as string, redactions),
    files,
  };
}

type OutsideError = 'bad_outside_shas' | 'too_many_outside_shas' | 'outside_shas_overlap';

function readOutsideShas(raw: unknown, recordShas: ReadonlyMap<string, number>): { shas: string[] } | OutsideError {
  if (raw === undefined || raw === null) return { shas: [] };
  if (!Array.isArray(raw)) return 'bad_outside_shas';
  if (raw.length > LIMITS.maxOutsideShas) return 'too_many_outside_shas';
  const shas: string[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    const sha = wellFormedSha(item);
    if (sha === null || seen.has(sha)) return 'bad_outside_shas';
    if (recordShas.has(sha)) return 'outside_shas_overlap';
    seen.add(sha);
    shas.push(sha);
  }
  return { shas };
}

function outsideDetail(code: OutsideError): string {
  switch (code) {
    case 'bad_outside_shas':
      return 'outside_shas must be an array of unique full hex shas';
    case 'too_many_outside_shas':
      return `outside_shas has more than ${LIMITS.maxOutsideShas} entries`;
    case 'outside_shas_overlap':
      return 'outside_shas contains a sha that is also a supplied commit';
  }
}

/** Lower-cased full sha, or null. Upper-case hex is accepted and normalised. */
function wellFormedSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sha = value.toLowerCase();
  return FULL_SHA.test(sha) ? sha : null;
}

/** null (binary) or a non-negative safe integer. Rejects negative, fractional and non-finite (e.g. 1e999) counts. */
function isCount(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && codePointLength(value) <= max;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
