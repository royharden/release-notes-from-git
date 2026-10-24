// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ExportFooter, ExportPanel, downloadBlob } from '../../src/ui/ExportPanel.tsx';
import { currentApprovalHash } from '../../src/core/export/gate.ts';
import type { ExportMeta } from '../../src/core/export/json.ts';
import type { ReviewState } from '../../src/core/rulings/types.ts';
import type { ValidateFn } from '../../src/core/validate/reasons.ts';
import { reviewBullet, verdict } from './helpers.ts';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const meta: ExportMeta = { version: 'v1.0.0', date: '2026-10-24', base_url: null, input_sha256: '1'.repeat(64), config_version: '2'.repeat(64) };
const validate: ValidateFn = (bullets) => bullets.map(() => verdict());
const state = (): ReviewState => ({ bullets: [reviewBullet()], latestApproval: null, notReplayed: [] });
async function approved(): Promise<ReviewState> {
  const review = state();
  const hash = await currentApprovalHash(review, meta, validate);
  if (!hash.ok) throw new Error(hash.detail);
  review.latestApproval = { ruling_id: 'approve-id', approval_hash: hash.hash };
  return review;
}
describe('approval and browser downloads', () => {
  it('keeps all three export controls disabled until the current hash is approved', async () => {
    const approve = vi.fn();
    const { rerender } = render(<ExportPanel state={state()} meta={meta} validate={validate} disabled={false} onMetaChange={vi.fn()} onApprove={approve} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve release notes' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve release notes' }));
    expect(approve).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    rerender(<ExportPanel state={await approved()} meta={meta} validate={validate} disabled={false} onMetaChange={vi.fn()} onApprove={approve} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Download release-notes.json' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download dropped.json' })).toBeEnabled();
  });
  it.each(['version', 'date', 'base_url'] as const)('invalidates %s changes immediately before a new asynchronous hash settles', async (field) => {
    const review = await approved();
    const props = { state: review, validate, disabled: false, onMetaChange: vi.fn(), onApprove: vi.fn() };
    const { rerender } = render(<ExportPanel {...props} meta={meta} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeEnabled());
    const changed = { ...meta, [field]: field === 'version' ? 'v2.0.0' : field === 'date' ? '2026-10-25' : 'https://example.test/repo' };
    rerender(<ExportPanel {...props} meta={changed} />);
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled();
    await screen.findByText(/content changed after approval/);
  });
  it.each(['edit', 'remove', 'restore', 'add'] as const)('invalidates a %s review state immediately', async (action) => {
    const review = await approved();
    const props = { meta, validate, disabled: false, onMetaChange: vi.fn(), onApprove: vi.fn() };
    const { rerender } = render(<ExportPanel {...props} state={review} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeEnabled());
    const bullet = { ...review.bullets[0]! };
    const changed: ReviewState = { ...review, bullets: [bullet] };
    if (action === 'edit') bullet.text += ' Updated.';
    if (action === 'remove') bullet.removed = true;
    if (action === 'restore') bullet.attestation = 'human_attested';
    if (action === 'add') changed.bullets.push(reviewBullet(null, { key: 'add', text: 'Added literal', origin: 'human_add' }));
    rerender(<ExportPanel {...props} state={changed} />);
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled();
    await screen.findByText(/content changed after approval/);
  });
  it('shows all six footer counts', () => {
    render(<ExportFooter counts={{ generated: 12, validator_kept: 8, validator_dropped: 4, human_removed: 2, human_restored: 1, human_added: 3 }} />);
    // Each count has its own dt/dd pair; the visible labels match the exported footer contract.
    expect(screen.getAllByRole('definition')).toHaveLength(6);
    const labels = ['Generated', 'Validator kept', 'Validator dropped', 'Human removed', 'Human restored', 'Human added'];
    const values = ['12', '8', '4', '2', '1', '3'];
    labels.forEach((label, index) => { const row = screen.getByText(label).parentElement!; expect(within(row).getByText(values[index]!)).toBeVisible(); });
  });
  it('downloads through a Blob URL and revokes it', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:synthetic');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadBlob('release-notes.md', '# Synthetic release', 'text/markdown');
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(clicked).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
    vi.useRealTimers();
  });
});
