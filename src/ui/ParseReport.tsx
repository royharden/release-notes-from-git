import type { ParseReport as Report } from '../core/gitlog/schema.ts';
import type { OversizedUnit } from '../core/gitfacts/chunk.ts';

export function ParseReport({ report, oversized, acknowledged, disabled, onAcknowledge }: { report: Report; oversized: readonly OversizedUnit[]; acknowledged: boolean; disabled: boolean; onAcknowledge: () => void }) {
  const omissions = report.rejected > 0 || oversized.length > 0;
  const redactions = Object.values(report.redactions).reduce((sum, n) => sum + n, 0);
  return <section className={`parse-report ${omissions ? 'has-omissions' : ''}`} aria-labelledby="parse-title">
    <div className="section-heading"><h3 id="parse-title">Input report</h3><span className="status-pill">{report.fileError ? 'File refused' : omissions ? 'Review omissions' : 'Ready to inspect'}</span></div>
    {report.fileError ? <p role="alert">{report.fileError.code}: {report.fileError.detail}</p> : <>
      <div className="report-metrics"><span><strong>{report.accepted}</strong> commits accepted</span><span><strong>{report.rejected}</strong> records rejected</span><span><strong>{redactions}</strong> redactions</span><span><strong>{oversized.length}</strong> oversized units omitted</span></div>
      <details><summary>Parse details and rejected records</summary><dl className="compact-list">{Object.entries(report.redactions).map(([kind, count]) => <div key={kind}><dt>{kind.replaceAll('_', ' ')}</dt><dd>{count}</dd></div>)}<div><dt>Other fields dropped</dt><dd>{report.droppedFields}</dd></div><div><dt>Outside-range SHAs</dt><dd>{report.outsideShas}</dd></div></dl>
        {report.rejectedRecords.length > 0 && <ul>{report.rejectedRecords.map((record) => <li key={`${record.index}-${record.code}`}>Record {record.index}: <code>{record.code}</code>{record.sha && <> · <code>{record.sha}</code></>}</li>)}</ul>}
        {oversized.length > 0 && <ul>{oversized.map((unit) => <li key={unit.unit_key}><code>{unit.unit_key}</code>: {unit.prompt_chars} prompt characters exceeds {unit.limit}; never sent.</li>)}</ul>}
      </details>
      {omissions && <label className="acknowledgement"><input type="checkbox" checked={acknowledged} disabled={disabled || acknowledged} onChange={onAcknowledge} />I acknowledge that rejected records and oversized units are omitted from generation.</label>}
    </>}
  </section>;
}
