// Parse report: counts and codes only. It never echoes removed or rejected text.

import { REJECT_CODES } from './schema.ts';
import type { FileErrorCode, ParseReport, RejectCode, RejectedRecord } from './schema.ts';
import type { RedactionCounts } from './redact.ts';

export interface ReportInput {
  accepted: number;
  rejected: readonly RejectedRecord[];
  redactions: RedactionCounts;
  droppedFields: number;
  outsideShas: number;
  fileError: { code: FileErrorCode; detail: string } | null;
}

export function buildReport(input: ReportInput): ParseReport {
  const rejectedByCode = Object.fromEntries(REJECT_CODES.map((code) => [code, 0])) as Record<RejectCode, number>;
  for (const record of input.rejected) rejectedByCode[record.code]++;
  const rejectedRecords = [...input.rejected].sort((a, b) => a.index - b.index).map((record) => ({ ...record }));
  return {
    accepted: input.accepted,
    rejected: input.rejected.length,
    rejectedByCode,
    rejectedRecords,
    redactions: { ...input.redactions },
    droppedFields: input.droppedFields,
    outsideShas: input.outsideShas,
    fileError: input.fileError,
  };
}

/** Plain-language summary lines for the parse report view. */
export function describeReport(report: ParseReport): string[] {
  if (report.fileError) return [`File rejected (${report.fileError.code}): ${report.fileError.detail}.`];
  const lines = [`${report.accepted} commit(s) accepted, ${report.rejected} record(s) rejected.`];
  for (const code of REJECT_CODES) {
    const n = report.rejectedByCode[code];
    if (n > 0) lines.push(`Rejected ${code}: ${n}.`);
  }
  const r = report.redactions;
  lines.push(
    `Removed: ${r.email} email-like string(s), ${r.name_trailer} name trailer line(s), ${r.author_field} author field(s)` +
      (r.credential_url > 0 ? `, ${r.credential_url} credentialed base_url` : '') +
      '.',
  );
  if (report.outsideShas > 0) lines.push(`${report.outsideShas} declared outside-range sha(s).`);
  return lines;
}
