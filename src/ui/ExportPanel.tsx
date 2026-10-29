import { useEffect, useRef, useState } from 'react';
import { currentApprovalHash, exportApproved } from '../core/export/gate.ts';
import type { ExportFiles } from '../core/export/gate.ts';
import type { ExportMeta } from '../core/export/json.ts';
import type { ReviewState } from '../core/rulings/types.ts';
import type { ValidateFn } from '../core/validate/reasons.ts';
import type { ExportCounts } from '../core/export/markdown.ts';

export function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Release after the click has reached the browser download task.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportFooter({ counts }: { counts: ExportCounts }) {
  const labels: Record<keyof ExportCounts, string> = { generated: 'Generated', validator_kept: 'Validator kept', validator_dropped: 'Validator dropped', human_removed: 'Human removed', human_restored: 'Human restored', human_added: 'Human added' };
  return <dl className="export-counts" aria-label="Export footer counts">{(Object.keys(labels) as (keyof ExportCounts)[]).map((key) => <div key={key}><dt>{labels[key]}</dt><dd>{counts[key]}</dd></div>)}</dl>;
}

interface GateSnapshot { state: ReviewState; signature: string; hash: string | null; detail: string; files: ExportFiles | null; counts: ExportCounts | null }
export function ExportPanel({ state, meta, validate, disabled, onMetaChange, onApprove }: { state: ReviewState; meta: ExportMeta; validate: ValidateFn; disabled: boolean; onMetaChange: (meta: ExportMeta) => void; onApprove: (hash: string) => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<GateSnapshot | null>(null);
  const signature = JSON.stringify(meta);
  const latest = useRef({ state, signature, disabled });
  latest.current = { state, signature, disabled };
  useEffect(() => {
    let current = true;
    async function check() {
      try {
        const approval = await currentApprovalHash(state, meta, validate);
        const exported = approval.ok ? await exportApproved(state, meta, validate) : approval;
        if (current) setSnapshot({ state, signature, hash: approval.ok ? approval.hash : null, detail: exported.ok ? 'Approval matches this exact content and release metadata.' : exported.detail, files: exported.ok ? exported : null, counts: approval.ok ? approval.prepared.document.counts : null });
      } catch {
        if (current) setSnapshot({ state, signature, hash: null, detail: 'The approval check could not complete. Try again after checking browser WebCrypto support.', files: null, counts: null });
      }
    }
    void check();
    return () => { current = false; };
  }, [state, meta, signature, validate]);
  // Stale asynchronous results never enable exports, even for a single render after an edit.
  const current = snapshot?.state === state && snapshot.signature === signature ? snapshot : null;
  const files = current?.files ?? null;
  const canDownload = !disabled && files !== null;
  const change = (field: 'version' | 'date' | 'base_url', value: string) => onMetaChange({ ...meta, [field]: field === 'base_url' && value === '' ? null : value });
  async function download(which: 'markdown' | 'releaseNotesJson' | 'droppedJson') {
    if (!canDownload) return;
    // Re-run the gate at the actual effect boundary; never download a cached unchecked payload.
    const checked = await exportApproved(state, meta, validate);
    if (!checked.ok || latest.current.state !== state || latest.current.signature !== signature || latest.current.disabled) return;
    const names = { markdown: 'release-notes.md', releaseNotesJson: 'release-notes.json', droppedJson: 'dropped.json' };
    downloadBlob(names[which], checked[which], which === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8');
  }
  return <section className="export-panel" aria-labelledby="export-title"><span className="eyebrow">03 / Release</span><h2 id="export-title">Approve the exact draft</h2><p>Set release metadata, review the counts, then approve. Any review action or metadata change requires approval again.</p>
    <div className="metadata-fields"><label>Version<input disabled={disabled} value={meta.version} placeholder="v1.0.0" onChange={(e) => change('version', e.target.value)} /></label><label>Release date<input disabled={disabled} type="date" value={meta.date} onChange={(e) => change('date', e.target.value)} /></label><label>Repository URL <span className="optional">optional</span><input disabled={disabled} type="url" value={meta.base_url ?? ''} placeholder="https://github.com/org/repo" onChange={(e) => change('base_url', e.target.value)} /></label></div>
    <p className="hint">Commit links use a clean HTTPS repository URL; otherwise citations stay plain text.</p>
    {current?.counts && <ExportFooter counts={current.counts} />}
    <div className={`approval-status ${files ? 'approved' : ''}`} role="status"><strong>{files ? 'Approved for download' : 'Approval required'}</strong><span>{current?.detail ?? 'Checking current content…'}</span></div>
    {current?.hash && <p className="hash-line">Content hash <code>{current.hash}</code></p>}
    <button className="primary full-width" disabled={disabled || !current?.hash || files !== null} onClick={() => { if (current?.hash) void onApprove(current.hash); }}>Approve release notes</button>
    <div className="download-actions"><button id="download-markdown" disabled={!canDownload} onClick={() => void download('markdown')}>Download Markdown</button><button disabled={!canDownload} onClick={() => void download('releaseNotesJson')}>Download release-notes.json</button><button disabled={!canDownload} onClick={() => void download('droppedJson')}>Download dropped.json</button></div>
    <p className="hint">Downloads stay in your browser. Approval records your review; it is not an attestation that commit text is true.</p>
  </section>;
}
