// Plain-language labels for every reason and warning code (labels from the PLAN-FINAL review table). Typed as
// exhaustive Records so adding a code without a label fails the type check. Plain TS: no React here.

import type { ReasonCode, WarningCode } from '../core/validate/reasons.ts';

export type ReasonGroup = 'citation' | 'content' | 'shape';

export interface ReasonLabel {
  label: string;
  group: ReasonGroup;
  /** One line shown beside the evidence. */
  help: string;
}

export const REPAIR_CITATIONS_FIRST = 'Repair citations first';

export const REASON_LABELS: Record<ReasonCode, ReasonLabel> = {
  no_citation: { label: 'Missing citation', group: 'citation', help: 'The bullet cites no commit.' },
  cite_not_found: {
    label: 'Unknown or rejected commit',
    group: 'citation',
    help: 'A cited sha is not in the input, or its record was rejected at parse.',
  },
  cite_ambiguous: { label: 'Ambiguous prefix', group: 'citation', help: 'A short sha matches more than one commit.' },
  cite_out_of_range: {
    label: 'Outside declared input',
    group: 'citation',
    help: 'A cited sha is declared outside the range, or was not in this request.',
  },
  reverted_in_range: { label: 'Cancelled change', group: 'citation', help: 'Every cited commit was reverted within the range.' },
  too_long: { label: 'Too long', group: 'shape', help: 'The bullet is longer than 240 characters.' },
  literal_not_in_evidence: {
    label: 'Unsupported literal',
    group: 'content',
    help: 'A number, version, date, id, identifier, flag or URL is not written in the cited commits.',
  },
  category_unsupported: {
    label: 'Unsupported category',
    group: 'content',
    help: 'Breaking needs a breaking marker; security needs a security word or CVE id in a cited commit.',
  },
  low_support: { label: 'Low text support', group: 'content', help: 'Too few of the bullet\'s words appear in the cited commits.' },
  duplicate_of: { label: 'Duplicate bullet', group: 'shape', help: 'An earlier kept bullet says the same about the same commits.' },
};

export const WARNING_LABELS: Record<WarningCode, ReasonLabel> = {
  category_mismatch: {
    label: 'Contradictory type',
    group: 'content',
    help: 'Every typed cited commit has a type that contradicts the bullet\'s category.',
  },
  possible_duplicate_unit: {
    label: 'Possible duplicate change',
    group: 'shape',
    help: 'A cited commit has the same subject and paths as another unit (no cherry-pick trailer).',
  },
};
