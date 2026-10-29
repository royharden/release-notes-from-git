import type { ReviewBullet } from '../../core/rulings/types.ts';
import type { FactIndex } from '../../core/gitfacts/facts.ts';
import { canRestore } from '../../core/rulings/replay.ts';
import { REASON_LABELS } from '../reason-labels.ts';
import { BulletText, EvidenceView, WarningList, Empty } from './shared.tsx';
import type { BulletActions } from './shared.tsx';

export function Dropped({ bullets, facts, selected, disabled, onSelect, onEdit, onRemove, onRestore }: { bullets: readonly ReviewBullet[]; facts: FactIndex; selected: number; disabled: boolean; onSelect: (index: number) => void } & BulletActions) {
  if (!bullets.length) return <Empty>No dropped bullets. Generation checks will appear here with their evidence.</Empty>;
  return <div className="review-list">{bullets.map((bullet, index) => {
    const restore = canRestore(bullet.verdict);
    return <article tabIndex={0} aria-label={`Dropped bullet ${index + 1}`} data-review-item key={bullet.key} className={`bullet-card dropped-card ${selected === index ? 'selected' : ''}`} onFocus={() => onSelect(index)} onClick={() => onSelect(index)}>
      <div className="bullet-meta"><span className="category">{bullet.category}</span><span className="drop-label">{bullet.verdict.reason ? REASON_LABELS[bullet.verdict.reason].label : 'Dropped'}</span></div>
      <BulletText bullet={bullet} /><ul className="reason-list">{bullet.verdict.reasons.map((reason) => <li key={reason}><strong>{REASON_LABELS[reason].label}</strong> — {REASON_LABELS[reason].help}</li>)}</ul><WarningList bullet={bullet} /><EvidenceView bullet={bullet} facts={facts} />
      <div className="card-actions"><button disabled={disabled} onClick={() => onEdit(bullet)}>Edit text or citations</button><button disabled={disabled || !restore.ok} aria-describedby={`restore-${bullet.key}`} onClick={() => onRestore(bullet)}>Restore with reason</button><button disabled={disabled} onClick={() => onRemove(bullet)}>Remove bullet</button></div>
      {!restore.ok && <p id={`restore-${bullet.key}`} className="hint">{restore.label}. Edit the bullet to repair its citations.</p>}
    </article>;
  })}</div>;
}
