import type { ReviewBullet } from '../../core/rulings/types.ts';
import type { FactIndex } from '../../core/gitfacts/facts.ts';
import { BulletText, EvidenceView, WarningList, Empty } from './shared.tsx';
import type { BulletActions } from './shared.tsx';

export function Kept({ bullets, facts, selected, disabled, onSelect, onEdit, onRemove }: { bullets: readonly ReviewBullet[]; facts: FactIndex; selected: number; disabled: boolean; onSelect: (index: number) => void } & BulletActions) {
  if (!bullets.length) return <Empty>No kept bullets yet. Generate a draft, or add a literal from Uncovered.</Empty>;
  return <div className="review-list">{bullets.map((bullet, index) => <article tabIndex={0} aria-label={`Kept bullet ${index + 1}`} data-review-item key={bullet.key} className={`bullet-card ${selected === index ? 'selected' : ''}`} onFocus={() => onSelect(index)} onClick={() => onSelect(index)}>
    <div className="bullet-meta"><span className="category">{bullet.category}</span><span>{bullet.attestation === 'human_attested' ? 'Human attested' : 'Validator kept'}</span>{bullet.origin !== 'model' && <span>{bullet.origin.replace('_', ' ')}</span>}</div>
    <BulletText bullet={bullet} /><WarningList bullet={bullet} />{bullet.restore_reason && <p className="attestation">Restored with reason: {bullet.restore_reason}</p>}<EvidenceView bullet={bullet} facts={facts} />
    <div className="card-actions"><button disabled={disabled} onClick={() => onEdit(bullet)}>Edit bullet</button><button disabled={disabled} onClick={() => onRemove(bullet)}>Remove bullet</button></div>
  </article>)}</div>;
}
