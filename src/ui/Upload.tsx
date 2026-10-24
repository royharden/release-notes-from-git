import { useRef, useState } from 'react';
import { LIMITS } from '@shared/limits.ts';
import { DEMO_FIXTURES } from '../services/demo-assets.ts';
import type { DemoFixture } from '../services/demo-assets.ts';

export function Upload({ disabled, onLoad }: { disabled: boolean; onLoad: (text: string, fixture: DemoFixture | null) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [fixture, setFixture] = useState<DemoFixture>('synthetic-traps');
  async function read(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > LIMITS.maxFileBytes) { setError('File exceeds the 5 MB upload limit.'); return; }
    try { await onLoad(await file.text(), null); } catch (problem) { setError(problem instanceof Error ? problem.message : 'File could not be read.'); }
    if (input.current) input.current.value = '';
  }
  return <section className="upload-panel" aria-labelledby="input-title">
    <div><span className="eyebrow">01 / Source</span><h2 id="input-title">Start with a commit range</h2><p>Load synthetic evidence or upload a <code>gitlog.v1</code> JSON file. Messages and paths only.</p></div>
    <div className="source-controls"><label>Example range<select value={fixture} disabled={disabled} onChange={(e) => setFixture(e.target.value as DemoFixture)}>{Object.entries(DEMO_FIXTURES).map(([id, value]) => <option key={id} value={id}>{value.label}{value.recorded ? ' · recorded demo' : ' · inspect only'}</option>)}</select></label>
      <button disabled={disabled} className="primary" onClick={() => { setError(''); void onLoad(DEMO_FIXTURES[fixture].text, fixture); }}>Load example</button>
      <span className="or">or</span><button disabled={disabled} onClick={() => input.current?.click()}>Upload JSON</button>
      <input ref={input} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Upload git log JSON" disabled={disabled} onChange={(e) => void read(e.target.files?.[0])} />
    </div>
    <p className="hint">Only Synthetic traps has exact recorded generations. Other inputs stay inspectable; replay misses are explicit.</p>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
