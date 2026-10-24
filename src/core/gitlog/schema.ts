// gitlog.v1 types after parsing. No author, committer, name or email field exists in any type here: the parser
// drops them, and tests/static asserts the shapes (M2).

export const GITLOG_SCHEMA = 'gitlog.v1';

/** Full commit id: SHA-1 (40 hex) or SHA-256 (64 hex), lower case. */
export const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Strict ISO-8601 date-time with seconds and an explicit offset, as `git log --format=%cI` writes it. */
export const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface SanitizedFile {
  path: string;
  /** null for binary files (numstat "-"). */
  added: number | null;
  deleted: number | null;
}

export interface SanitizedCommit {
  sha: string;
  parents: string[];
  date: string;
  subject: string;
  body: string;
  files: SanitizedFile[];
}

export const SANITIZED_COMMIT_FIELDS = ['sha', 'parents', 'date', 'subject', 'body', 'files'] as const satisfies readonly (keyof SanitizedCommit)[];
export const SANITIZED_FILE_FIELDS = ['path', 'added', 'deleted'] as const satisfies readonly (keyof SanitizedFile)[];

/** Record-level rejection codes, in the order the checks run. Stable: eval and UI key on them. */
export const REJECT_CODES = [
  'not_object',
  'bad_sha',
  'bad_parents',
  'bad_date',
  'bad_subject',
  'bad_body',
  'body_too_long',
  'bad_files',
  'too_many_files',
  'bad_file',
  'bad_counts',
  'duplicate_sha',
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export interface RejectedRecord {
  /** Index in the input `commits` array. */
  index: number;
  /** Kept when the record carried a well-formed sha, so a bullet citing it drops as cite_not_found with provenance. */
  sha?: string;
  code: RejectCode;
}

/** File-level failures: the whole upload is refused. */
export const FILE_ERROR_CODES = [
  'too_large',
  'not_json',
  'bad_schema',
  'bad_header',
  'too_many_commits',
  'bad_outside_shas',
  'too_many_outside_shas',
  'outside_shas_overlap',
] as const;
export type FileErrorCode = (typeof FILE_ERROR_CODES)[number];

export const REDACTION_KINDS = [
  'email', // email-like string removed from a retained string
  'name_trailer', // a `*-by:` / `Cc:` style trailer line dropped
  'author_field', // an author/committer/name/email field dropped from the input
  'credential_url', // base_url carried credentials and was discarded
] as const;
export type RedactionKind = (typeof REDACTION_KINDS)[number];

export interface SanitizedLog {
  schema: typeof GITLOG_SCHEMA;
  repo_label: string;
  from_ref: string;
  to_ref: string;
  base_url: string | null;
  commits: SanitizedCommit[];
  /** Declared known-outside ids (full shas, disjoint from every supplied record sha). */
  outside_shas: string[];
  rejected: RejectedRecord[];
}

export interface ParseReport {
  accepted: number;
  rejected: number;
  rejectedByCode: Record<RejectCode, number>;
  /** Index and code of every rejected record (sha when well-formed); never the record's text. */
  rejectedRecords: RejectedRecord[];
  redactions: Record<RedactionKind, number>;
  /** Unknown input fields dropped that were not author-like (counted, not echoed). */
  droppedFields: number;
  outsideShas: number;
  fileError: { code: FileErrorCode; detail: string } | null;
}

export type ParseResult = { ok: true; log: SanitizedLog; report: ParseReport } | { ok: false; report: ParseReport };
