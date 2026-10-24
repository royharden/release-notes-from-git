import { useEffect, useRef, useState } from 'react';
import { CATEGORIES } from '@shared/output-schema.ts';
import type { Category } from '@shared/output-schema.ts';
import type { ReviewBullet, BulletContent } from '../core/rulings/types.ts';

export type DialogAction = { kind: 'edit' | 'restore'; bullet: ReviewBullet };
export function ReviewDialog({ action, disabled, onClose, onSave }: { action: DialogAction; disabled: boolean; onClose: () => void; onSave: (content: BulletContent, reason: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(action.bullet.text);
  const [category, setCategory] = useState<Category>(action.bullet.category);
  const [cites, setCites] = useState(action.bullet.cites.join('\n'));
  const [reason, setReason] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="review-dialog-title" onCancel={(e) => { if (disabled) e.preventDefault(); else onClose(); }}><form onSubmit={(e) => { e.preventDefault(); void onSave({ text, category, cites: cites.split(/[\s,]+/u).map((cite) => cite.trim().toLowerCase()).filter(Boolean) }, reason.trim()); }}>
    <div className="section-heading"><h2 id="review-dialog-title">{action.kind === 'edit' ? 'Edit & revalidate' : 'Restore with your attestation'}</h2><button type="button" aria-label="Close review dialog" disabled={disabled} onClick={onClose}>×</button></div>
    {action.kind === 'edit' ? <><p>Saving appends an edit event and runs every validator check again.</p><label>Bullet text<textarea autoFocus required rows={4} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} /></label><label>Category<select value={category} disabled={disabled} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Commit citations<textarea required rows={3} value={cites} disabled={disabled} onChange={(e) => setCites(e.target.value)} /></label><p className="hint">Full SHA or at least 7 hex characters; separate citations with spaces, commas or newlines.</p></> : <><p className="bullet-text">{action.bullet.text}</p><p>This soft drop will be visibly marked <strong>human attested</strong> in the notes and JSON.</p><label>Why are you restoring this bullet?<textarea autoFocus required rows={4} value={reason} disabled={disabled} onChange={(e) => setReason(e.target.value)} /></label></>}
    <div className="dialog-actions"><button type="button" disabled={disabled} onClick={onClose}>Cancel</button><button className="primary" disabled={disabled || (action.kind === 'restore' ? reason.trim() === '' : text.trim() === '' || cites.trim() === '')}>{action.kind === 'edit' ? 'Save & revalidate' : 'Restore bullet'}</button></div>
  </form></dialog>;
}
