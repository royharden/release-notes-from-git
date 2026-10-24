// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Kept } from '../../src/ui/review/Kept.tsx';
import { Dropped } from '../../src/ui/review/Dropped.tsx';
import { Uncovered } from '../../src/ui/review/Uncovered.tsx';
import { Highlight } from '../../src/ui/Highlight.tsx';
import { ParseReport } from '../../src/ui/ParseReport.tsx';
import { HARD_REASONS, REASON_CODES, SOFT_REASONS } from '../../src/core/validate/reasons.ts';
import { REASON_LABELS } from '../../src/ui/reason-labels.ts';
import { pipeline, fixtureText } from '../helpers/fixtures.ts';
import { parseLog } from '../../src/core/gitlog/parse.ts';
import { reviewBullet } from './helpers.ts';

afterEach(cleanup);
const p = pipeline('synthetic-traps');
const actions = { onEdit: vi.fn(), onRemove: vi.fn(), onRestore: vi.fn(), onSelect: vi.fn() };
describe('review membership and evidence', () => {
  it('renders kept bullets and human attestations separately from dropped and uncovered units', () => {
    const restored = reviewBullet('low_support', { text: 'Human restored draft', attestation: 'human_attested', restore_reason: 'Reviewed against the commit' });
    render(<Kept bullets={[restored]} facts={p.facts} selected={0} disabled={false} {...actions} />);
    expect(screen.getByRole('article', { name: 'Kept bullet 1' })).toHaveTextContent('Human restored draft');
    expect(screen.getByText('Human attested')).toBeInTheDocument();
    expect(screen.getByText(/Reviewed against the commit/)).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Dropped/ })).not.toBeInTheDocument();
  });
  it.each(REASON_CODES)('renders the exhaustive %s label, explanation, and evidence', (reason) => {
    render(<Dropped bullets={[reviewBullet(reason)]} facts={p.facts} selected={0} disabled={false} {...actions} />);
    expect(screen.getAllByText(REASON_LABELS[reason].label).length).toBeGreaterThan(0);
    expect(screen.getByText(REASON_LABELS[reason].help, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Inspect citations/));
    expect(screen.getByText('Synthetic evidence detail')).toBeVisible();
  });
  it.each(HARD_REASONS)('%s cannot be restored and exposes the repair instruction', (reason) => {
    render(<Dropped bullets={[reviewBullet(reason)]} facts={p.facts} selected={0} disabled={false} {...actions} />);
    expect(screen.getByRole('button', { name: 'Restore with reason' })).toBeDisabled();
    expect(screen.getByText(/Repair citations first/)).toBeVisible();
  });
  it.each(SOFT_REASONS)('%s can be restored when every cite resolves and is active', (reason) => {
    render(<Dropped bullets={[reviewBullet(reason)]} facts={p.facts} selected={0} disabled={false} {...actions} />);
    expect(screen.getByRole('button', { name: 'Restore with reason' })).toBeEnabled();
  });
  it('refuses even a soft drop when a cited commit is inactive', () => {
    const bullet = reviewBullet('low_support');
    bullet.verdict.evidence.cites = [{ cite: 'a'.repeat(40), status: 'resolved', sha: 'a'.repeat(40), active: false }];
    render(<Dropped bullets={[bullet]} facts={p.facts} selected={0} disabled={false} {...actions} />);
    expect(screen.getByRole('button', { name: 'Restore with reason' })).toBeDisabled();
  });
  it('offers literal-add controls for typed and untyped uncovered changes', () => {
    const typed = p.units.find((unit) => unit.type === 'feat')!;
    const untyped = p.units.find((unit) => unit.type === 'unknown' && unit.noise_reason === null)!;
    const add = vi.fn();
    render(<Uncovered uncovered={{ typed: [typed], untyped: [untyped] }} selected={0} disabled={false} onSelect={vi.fn()} onAdd={add} onAddAll={vi.fn()} />);
    const items = screen.getAllByRole('article');
    expect(items).toHaveLength(2);
    fireEvent.click(within(items[0]!).getByRole('button', { name: 'Add literal bullet' }));
    expect(add).toHaveBeenCalledWith(typed);
  });
});

describe('text-node highlight and parse acknowledgement', () => {
  it('preserves dangerous markup as visible text and highlights stemmed evidence terms', () => {
    const raw = '<script>alert(1)</script> [click](javascript:alert(2)) exports';
    const { container } = render(<Highlight text={raw} matched={['export']} />);
    expect(container.textContent).toBe(raw);
    expect(container.querySelector('script, a, img')).toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('exports');
  });
  it('reports rejected records and redaction counts and requires explicit acknowledgement', () => {
    const parsed = parseLog(fixtureText('synthetic-traps'));
    const ack = vi.fn();
    render(<ParseReport report={parsed.report} oversized={[]} acknowledged={false} disabled={false} onAcknowledge={ack} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(ack).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Parse details and rejected records'));
    expect(screen.getByText('body_too_long')).toBeVisible();
    expect(screen.getByText('email')).toBeInTheDocument();
  });
});
