import type { ReactNode } from 'react';
import type { ReviewBullet } from '../../core/rulings/types.ts';
import type { FactIndex } from '../../core/gitfacts/facts.ts';
import { Highlight } from '../Highlight.tsx';
import { WARNING_LABELS } from '../reason-labels.ts';

export interface BulletActions {
  onEdit: (bullet: ReviewBullet) => void;
  onRemove: (bullet: ReviewBullet) => void;
  onRestore: (bullet: ReviewBullet) => void;
}
export function BulletText({ bullet }: { bullet: ReviewBullet }) {
  return <p className="bullet-text"><Highlight text={bullet.text} matched={bullet.verdict.evidence.matchedTerms} missing={bullet.verdict.evidence.unmatchedTerms} /></p>;
}
export function EvidenceView({ bullet, facts }: { bullet: ReviewBullet; facts: FactIndex }) {
  const evidence = bullet.verdict.evidence;
  return <details className="evidence"><summary>Inspect citations &amp; evidence <span>{bullet.cites.length} cite{bullet.cites.length === 1 ? '' : 's'}</span></summary>
    {evidence.cites.length === 0 && <p>No citations supplied.</p>}
    {evidence.cites.map((cite, index) => <div className="commit-evidence" key={`${cite.cite}-${index}`}><code>{cite.cite}</code><span className="status-pill">{cite.status}{cite.status === 'resolved' && !cite.active ? ' · cancelled' : ''}</span>
      {cite.status === 'resolved' && facts.commits.has(cite.sha) && <><p><Highlight text={facts.commits.get(cite.sha)!.subject} matched={evidence.matchedTerms} /></p><pre>{facts.commits.get(cite.sha)!.body}</pre><ul className="paths">{facts.commits.get(cite.sha)!.paths.map((path) => <li key={path}>{path}</li>)}</ul></>}
      {cite.status === 'not_found' && cite.rejectedCode && <p>Commit rejected at parse: {cite.rejectedCode}</p>}
      {cite.status === 'ambiguous' && <p>Matches: {cite.candidates.join(', ')}</p>}
      {cite.status === 'out_of_range' && <p>{cite.basis === 'not_in_request' ? 'Not in request input' : cite.basis.replaceAll('_', ' ')}</p>}
    </div>)}
    {evidence.notes.map((note, index) => <p key={index}>{note}</p>)}
    {evidence.missingLiterals.length > 0 && <p>Missing literals: {evidence.missingLiterals.join(', ')}</p>}
    {evidence.unmatchedTerms.length > 0 && <p>Unsupported terms: {evidence.unmatchedTerms.join(', ')}</p>}
    {bullet.verdict.support_score !== null && <p>Lexical support: {Math.round(bullet.verdict.support_score * 100)}% (a text check, not a truth score).</p>}
  </details>;
}
export function WarningList({ bullet }: { bullet: ReviewBullet }) {
  return <>{bullet.verdict.warnings.map((warning) => <p className="warning-note" key={warning}>{WARNING_LABELS[warning].label}: {WARNING_LABELS[warning].help}</p>)}</>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
