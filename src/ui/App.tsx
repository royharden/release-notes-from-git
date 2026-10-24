import { useEffect, useRef, useState } from 'react';
import type { WireUnit } from '@shared/units-wire.ts';
import { sha256Canonical } from '@shared/hash.ts';
import { parseLog } from '../core/gitlog/parse.ts';
import type { ParseReport as Report, SanitizedLog } from '../core/gitlog/schema.ts';
import { buildFacts } from '../core/gitfacts/facts.ts';
import type { FactIndex } from '../core/gitfacts/facts.ts';
import { groupUnits, uncoveredUnits } from '../core/gitfacts/units.ts';
import type { UnitDraft } from '../core/gitfacts/units.ts';
import { chunkUnits } from '../core/gitfacts/chunk.ts';
import type { OversizedUnit } from '../core/gitfacts/chunk.ts';
import { literalBullet } from '../core/baseline/rule-based.ts';
import { configVersion, evidenceFingerprint } from '../core/rulings/fingerprint.ts';
import { applyRulings, canRestore, initialReviewState } from '../core/rulings/replay.ts';
import { isLive } from '../core/rulings/types.ts';
import type { BulletContent, ReviewBullet, ReviewState, Ruling } from '../core/rulings/types.ts';
import type { ValidateFn } from '../core/validate/reasons.ts';
import { validatorContext } from '../core/validate/validate.ts';
import type { ValidatorContext } from '../core/validate/validate.ts';
import type { ExportMeta } from '../core/export/json.ts';
import { currentApprovalHash } from '../core/export/gate.ts';
import { MemoryRunRepository } from '../data/memory-repo.ts';
import type { LedgerRow, RunRecord } from '../data/repo.ts';
import { resolveMode } from '../lib/mode.ts';
import type { AppMode } from '../lib/mode.ts';
import { DemoGenerationError, generateDemo, makeReviewValidator, validatorForRulings } from '../services/generation.ts';
import type { RequestDrop } from '../services/generation.ts';
import type { DemoFixture } from '../services/demo-assets.ts';
import { Upload } from './Upload.tsx';
import { ParseReport } from './ParseReport.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { Kept } from './review/Kept.tsx';
import { Dropped } from './review/Dropped.tsx';
import { Uncovered } from './review/Uncovered.tsx';
import { Internal } from './review/Internal.tsx';
import { ReviewDialog } from './ReviewDialog.tsx';
import type { DialogAction } from './ReviewDialog.tsx';
import { keyboardAction, SHORTCUTS } from './keyboard.ts';

type Tab = 'kept' | 'dropped' | 'uncovered' | 'internal';
interface Session {
  run: RunRecord; log: SanitizedLog; facts: FactIndex; units: WireUnit[]; oversized: OversizedUnit[];
  fixture: DemoFixture | null; ctx: ValidatorContext; validate: ValidateFn; initial: ReviewState;
  review: ReviewState; generated: boolean; requestDrops: RequestDrop[]; ledger: LedgerRow[]; rulings: Ruling[];
}
const TAB_LABELS: Record<Tab, string> = { kept: 'Kept', dropped: 'Dropped', uncovered: 'Uncovered', internal: 'Internal' };
const TABS = Object.keys(TAB_LABELS) as Tab[];

export function App({ mode: suppliedMode, repository: suppliedRepository }: { mode?: AppMode; repository?: MemoryRunRepository } = {}) {
  const [mode] = useState(() => suppliedMode ?? resolveMode(import.meta.env, window.location.search));
  const [repository] = useState(() => suppliedRepository ?? new MemoryRunRepository());
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState<ExportMeta>({ version: '', date: '', base_url: null, input_sha256: '', config_version: '' });
  const [tab, setTab] = useState<Tab>('kept');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lastRulingTime = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [help, setHelp] = useState(false);
  const reviewPane = useRef<HTMLDivElement>(null);

  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (problem) { setError(problem instanceof Error ? problem.message : 'The action could not complete.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function load(text: string, fixture: DemoFixture | null) {
    await perform(async () => {
      const parsed = parseLog(text);
      setReport(parsed.report); setSession(null); setDialog(null); setNotice('');
      if (!parsed.ok) return;
      const facts = buildFacts(parsed.log);
      const grouped = groupUnits(facts);
      if (!grouped.ok) throw new Error(`Input refused: ${grouped.unitCount} units exceeds the ${grouped.limit}-unit cap. No units were silently truncated.`);
      const chunked = chunkUnits(grouped.units);
      if (!chunked.ok) throw new Error(`Input refused: ${chunked.chunkCount} chunks exceeds the ${chunked.limit}-chunk cap. ${chunked.oversized.length} oversized units were also identified.`);
      const duplicateShas = new Set(grouped.units.filter((unit) => grouped.possibleDuplicates.has(unit.unit_key)).flatMap((unit) => unit.shas));
      const ctx = validatorContext(facts, { possibleDuplicateShas: duplicateShas });
      const validate = makeReviewValidator(ctx, []);
      const version = await configVersion();
      const inputHash = await sha256Canonical(parsed.log);
      let run = await repository.createRun({ repo_label: parsed.log.repo_label, from_ref: parsed.log.from_ref, to_ref: parsed.log.to_ref, input_sha256: inputHash, config_version: version, parse_report: parsed.report, has_unit_omissions: chunked.oversized.length > 0 });
      await repository.insertUnits(run.id, chunked.units);
      run = await repository.getRun(run.id);
      const initial = await initialReviewState([], validate);
      setSession({ run, log: parsed.log, facts, units: chunked.units, oversized: chunked.oversized, fixture, ctx, validate, initial, review: initial, generated: false, requestDrops: [], ledger: [], rulings: [] });
      setMeta({ version: '', date: '', base_url: parsed.log.base_url, input_sha256: inputHash, config_version: version });
      setTab('internal'); setSelected(0); setNotice('Input parsed. Inspect the report before generating.');
    });
  }

  async function acknowledge() {
    if (!session) return;
    await perform(async () => { await repository.acknowledgeOmissions(session.run.id); setSession({ ...session, run: await repository.getRun(session.run.id) }); setNotice('Omissions acknowledged. You can generate the recorded draft.'); });
  }

  async function generate() {
    if (!session || session.generated) return;
    await perform(async () => {
      const run = session.run.status === 'draft' ? await repository.sealRun(session.run.id) : session.run;
      try {
        const generated = await generateDemo(session.units, session.fixture);
        for (const row of generated.ledger) await repository.recordDemoCall(run.id, row);
        const validate = makeReviewValidator(session.ctx, generated.requestDrops);
        const initial = await initialReviewState(generated.bullets, validate);
        await repository.saveBullets(run.id, initial, generated.requestDrops, generated.violations);
        setSession({ ...session, run: await repository.getRun(run.id), validate, initial, review: initial, generated: true, requestDrops: generated.requestDrops, ledger: await repository.listLedger(run.id) });
        setTab('kept'); setSelected(0); setNotice('Recorded draft ready. Review dropped and uncovered changes before approval.');
      } catch (problem) {
        if (problem instanceof DemoGenerationError) for (const row of problem.ledger) await repository.recordDemoCall(run.id, row);
        setSession({ ...session, run: await repository.getRun(run.id), ledger: await repository.listLedger(run.id) });
        throw problem;
      }
    });
  }

  async function append(events: Ruling[], active: Session) {
    for (const event of events) await repository.appendRuling(active.run.id, event);
    const rulings = await repository.listRulings(active.run.id);
    const validate = await validatorForRulings(active.ctx, active.requestDrops, active.initial, rulings);
    const review = await applyRulings(active.initial, rulings, { validate, fingerprint: (cites) => evidenceFingerprint(cites, { facts: active.facts }), configVersion: active.run.config_version });
    // Every explicit review action invalidates approval, including a no-op text save.
    if (events.some((event) => event.action !== 'approve')) review.latestApproval = null;
    setSession({ ...active, review, rulings, validate });
  }

  async function rulingBase(target: ReviewBullet | null, cites: readonly string[], active: Session) {
    lastRulingTime.current = Math.max(Date.now(), lastRulingTime.current + 1);
    return { id: crypto.randomUUID(), target_key: target?.key ?? '', fingerprint: await evidenceFingerprint(cites, { facts: active.facts }), config_version: active.run.config_version, approval_hash: null, reason: null, actor: 'local-demo', created_at: new Date(lastRulingTime.current).toISOString() };
  }

  function openRestore(bullet: ReviewBullet) {
    if (canRestore(bullet.verdict).ok) setDialog({ kind: 'restore', bullet });
    else setNotice('Repair citations first. Use Edit text or citations.');
  }

  async function remove(bullet: ReviewBullet) {
    if (!session) return;
    await perform(async () => { await append([{ ...await rulingBase(bullet, bullet.cites, session), action: 'remove', payload: {} }], session); setNotice('Bullet removed. Approval is required again.'); });
  }

  async function saveDialog(content: BulletContent, reason: string) {
    if (!session || !dialog) return;
    await perform(async () => {
      const base = await rulingBase(dialog.bullet, dialog.bullet.cites, session);
      if (dialog.kind === 'restore') {
        if (!reason.trim() || !canRestore(dialog.bullet.verdict).ok) throw new Error('A restore needs active citations, a soft drop and your reason.');
        await append([{ ...base, action: 'restore', reason, payload: {} }], session);
      } else await append([{ ...base, action: 'edit', payload: content }], session);
      setDialog(null); setNotice('Review event saved and the draft revalidated. Approval is required again.');
    });
  }

  async function addUnits(units: readonly UnitDraft[]) {
    if (!session || !session.generated || !units.length) return;
    await perform(async () => {
      const events: Ruling[] = [];
      for (const unit of units) {
        const content = literalBullet(unit, session.facts);
        events.push({ ...await rulingBase(null, content.cites, session), action: 'add', payload: { ...content, source_unit_key: unit.unit_key } });
      }
      await append(events, session); setNotice(`${events.length} literal bullet(s) added and validated. Approval is required again.`);
    });
  }

  async function approve(hash: string) {
    if (!session || !session.generated) return;
    await perform(async () => {
      const checked = await currentApprovalHash(session.review, meta, session.validate);
      if (!checked.ok || checked.hash !== hash) throw new Error('Draft changed during approval. Review the current draft and approve again.');
      await append([{ ...await rulingBase(null, [], session), action: 'approve', target_key: hash, approval_hash: hash, payload: { version: meta.version, date: meta.date, base_url: meta.base_url } }], session);
      setNotice('This exact draft and metadata are approved for browser download.');
    });
  }

  const live = session?.review.bullets.filter(isLive) ?? [];
  const kept = live.filter((bullet) => bullet.verdict.kept || bullet.attestation === 'human_attested');
  const dropped = live.filter((bullet) => !bullet.verdict.kept && bullet.attestation !== 'human_attested');
  const covered = new Set(kept.flatMap((bullet) => bullet.verdict.evidence.activeShas));
  const uncovered = uncoveredUnits(session?.units ?? [], covered);
  const uncoveredList = [...uncovered.typed, ...uncovered.untyped];
  const counts: Record<Tab, number> = { kept: kept.length, dropped: dropped.length, uncovered: uncoveredList.length, internal: session?.units.length ?? 0 };
  const itemCount = tab === 'internal' ? 0 : counts[tab];
  const selection = tab === 'kept' ? kept[selected] : tab === 'dropped' ? dropped[selected] : undefined;
  const omissions = session ? session.run.parse_report.rejected > 0 || session.oversized.length > 0 : false;
  const ready = session !== null && (!omissions || session.run.omissions_ack_at !== null) && session.units.length > 0;
  function switchTab(next: Tab) { setTab(next); setSelected(0); }
  function moveSelection(step: number) {
    const next = Math.min(Math.max(0, itemCount - 1), Math.max(0, selected + step));
    setSelected(next);
    reviewPane.current?.querySelectorAll<HTMLElement>('[data-review-item]')[next]?.focus();
  }
  useEffect(() => { setSelected((index) => Math.min(index, Math.max(0, itemCount - 1))); }, [itemCount]);

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (dialog || help || busy) return;
      const action = keyboardAction(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'help') { setHelp(true); return; }
      if (action === 'kept' || action === 'dropped' || action === 'uncovered' || action === 'internal') { switchTab(action); return; }
      if (action === 'next' || action === 'previous') {
        moveSelection(action === 'next' ? 1 : -1);
      } else if (action === 'edit' && selection) setDialog({ kind: 'edit', bullet: selection });
      else if (action === 'restore' && selection && tab === 'dropped') openRestore(selection);
      else if (action === 'remove' && selection) void remove(selection);
      else if (action === 'add' && tab === 'uncovered' && uncoveredList[selected]) void addUnits([uncoveredList[selected]!]);
      else if (action === 'addAll' && tab === 'uncovered') void addUnits(uncoveredList);
      else if (action === 'download') document.getElementById('download-markdown')?.click();
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });

  return <div className="app-shell"><header className="topbar"><a href="?demo=1" className="brand" aria-label="Release Notes from Git home"><span className="brand-symbol" aria-hidden="true">↗</span><span>Release Notes<span className="brand-subtitle">from git</span></span></a><div className="topbar-actions"><span className="status-pill">{mode.kind === 'demo' ? 'Offline demo' : 'Live setup'}</span><button onClick={() => setHelp(true)}>Keyboard shortcuts <kbd>?</kbd></button></div></header>
    <main><section className="hero"><div><span className="eyebrow">A little less guesswork. A clear paper trail.</span><h1>Release notes.<br /><span>With receipts.</span></h1><p>Turn a commit range into a draft you can inspect. Every exported bullet points back to commit messages and paths.</p></div><aside className="hero-note"><span aria-hidden="true">↳</span><p>Traceable to your commits.<br /><strong>You decide what ships.</strong></p><small>Text checks support review.<br />They do not prove a claim is true.</small></aside></section>
      <div className="mode-banner" role="status">{mode.kind === 'demo' ? <><span className="demo-dot" />Demo mode · no account, keys or network calls. Synthetic evidence and recordings; refresh clears your review.</> : <><strong>{mode.kind === 'setup' ? 'Configuration needed.' : 'Live connection is not activated in this milestone.'}</strong> {mode.kind === 'setup' ? mode.detail : 'Auth and the live repository will be connected in M4. No live request has been made.'} <a href="?demo=1">Open offline demo</a></>}</div>
      {mode.kind === 'demo' && <><Upload disabled={busy} onLoad={load} />{report && <ParseReport report={report} oversized={session?.oversized ?? []} acknowledged={Boolean(session?.run.omissions_ack_at)} disabled={busy || !session} onAcknowledge={() => void acknowledge()} />}
      {error && <div className="message error" role="alert">{error}</div>}<p className="live-announcement" aria-live="polite">{busy ? 'Saving and checking…' : notice}</p>
      {session ? <><section className="range-heading"><div><span className="eyebrow">02 / Review</span><h2>{session.log.repo_label}</h2><p><code>{session.log.from_ref}</code><span aria-hidden="true"> → </span><code>{session.log.to_ref}</code><span className="range-divider">/</span>{session.units.length} change units · {new Set(session.units.map((unit) => unit.chunk_index)).size} chunks</p></div><button className="primary generate-button" disabled={busy || !ready || session.generated} onClick={() => void generate()}>{busy ? 'Checking…' : session.generated ? 'Draft generated' : 'Generate recorded draft'}<span aria-hidden="true"> ↗</span></button></section>
        {!ready && <p className="hint">Acknowledge input omissions above before generation.{session.units.length === 0 ? ' There are no units available to generate.' : ''}</p>}
        <div className="workbench"><section className="review-panel"><div role="tablist" aria-label="Review categories" className="tabs">{TABS.map((value, index) => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); const next = event.key === 'Home' ? TABS[0]! : event.key === 'End' ? TABS[3]! : TABS[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4]!; switchTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{TAB_LABELS[value]}<span>{counts[value]}</span></button>)}</div>
          {tab !== 'internal' && <div className="selection-toolbar"><span>{itemCount ? `Item ${selected + 1} of ${itemCount}` : 'No items'}</span><div><button aria-label="Previous item" disabled={busy || selected === 0 || itemCount === 0} onClick={() => moveSelection(-1)}>← Previous</button><button aria-label="Next item" disabled={busy || selected >= itemCount - 1} onClick={() => moveSelection(1)}>Next →</button></div></div>}
          <div ref={reviewPane} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="tab-content">
            {tab === 'kept' && <Kept bullets={kept} facts={session.facts} selected={selected} disabled={busy} onSelect={setSelected} onEdit={(bullet) => setDialog({ kind: 'edit', bullet })} onRemove={(bullet) => void remove(bullet)} onRestore={openRestore} />}
            {tab === 'dropped' && <Dropped bullets={dropped} facts={session.facts} selected={selected} disabled={busy} onSelect={setSelected} onEdit={(bullet) => setDialog({ kind: 'edit', bullet })} onRemove={(bullet) => void remove(bullet)} onRestore={openRestore} />}
            {tab === 'uncovered' && <Uncovered uncovered={uncovered} selected={selected} disabled={busy || !session.generated} onSelect={setSelected} onAdd={(unit) => void addUnits([unit])} onAddAll={() => void addUnits(uncoveredList)} />}
            {tab === 'internal' && <Internal units={session.units} facts={session.facts} ledger={session.ledger} notReplayed={session.review.notReplayed} requestDrops={session.requestDrops} violations={session.run.violations} rulings={session.rulings} />}
          </div><div className="review-legend"><span><i className="legend-match" />Words found in evidence</span><span><i className="legend-missing" />Words needing review</span></div>
        </section><ExportPanel state={session.review} meta={meta} validate={session.validate} disabled={busy || !session.generated} onMetaChange={(next) => { setMeta(next); setSession({ ...session, review: { ...session.review, latestApproval: null } }); setNotice('Release metadata changed. Approval must match the new content hash.'); }} onApprove={approve} /></div>
      </> : !report?.fileError && <section className="start-empty"><span aria-hidden="true">⌘</span><h2>A commit range is your starting point.</h2><p>Try Synthetic traps to inspect rejected records, planted overclaims,<br />revert chains, and a complete review-to-export journey.</p></section>}</>}
    </main><footer className="site-footer"><span>Release Notes from Git</span><p>Commit messages are evidence to inspect, not a source of truth.</p><span>Local drafts. Explicit approval.</span></footer>
    {dialog && <ReviewDialog key={`${dialog.kind}-${dialog.bullet.key}`} action={dialog} disabled={busy} onClose={() => setDialog(null)} onSave={saveDialog} />}
    {help && <HelpDialog onClose={() => setHelp(false)} />}
  </div>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; const previous = document.activeElement; element?.showModal(); return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby="keyboard-title" onCancel={onClose}><div className="section-heading"><h2 id="keyboard-title">Keyboard shortcuts</h2><button autoFocus aria-label="Close keyboard shortcuts" onClick={onClose}>×</button></div><p>Shortcuts pause while typing in a field. Every action is also available as a labelled button.</p><dl className="shortcut-list">{SHORTCUTS.map((shortcut) => <div key={shortcut.key}><dt><kbd>{shortcut.key}</kbd></dt><dd>{shortcut.label}</dd></div>)}</dl></dialog>;
}
