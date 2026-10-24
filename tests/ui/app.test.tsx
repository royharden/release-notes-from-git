// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from '../../src/ui/App.tsx';
import { ReviewDialog } from '../../src/ui/ReviewDialog.tsx';
import { reviewBullet } from './helpers.ts';

beforeAll(() => {
  // jsdom does not implement native modal focus/inert behaviour; real-browser coverage is deferred.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('keyless review journey', () => {
  it('requires acknowledgement, populates all four tabs, restores a soft drop and exports only after approval', async () => {
    render(<App mode={{ kind: 'demo' }} />);
    expect(screen.getByText(/no account, keys or network calls/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    const generate = await screen.findByRole('button', { name: /Generate recorded draft/ });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(generate).toBeEnabled());
    expect(screen.getByRole('tab', { name: /Internal/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(generate);
    await waitFor(() => expect(screen.getByRole('button', { name: /Draft generated/ })).toBeDisabled());
    expect(screen.getByRole('tab', { name: /Kept/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('article', { name: /Kept bullet/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /Dropped/ }));
    const lowSupport = screen.getAllByRole('article', { name: /Dropped bullet/ }).find((article) => article.textContent?.includes('Mistyped subcommands now abort early.'))!;
    expect(lowSupport).toBeDefined();
    fireEvent.click(within(lowSupport).getByRole('button', { name: 'Restore with reason' }));
    const restoreDialog = screen.getByRole('dialog');
    expect(within(restoreDialog).getByRole('button', { name: 'Restore bullet' })).toBeDisabled();
    fireEvent.change(within(restoreDialog).getByLabelText('Why are you restoring this bullet?'), { target: { value: 'Reviewed the command handling change.' } });
    fireEvent.click(within(restoreDialog).getByRole('button', { name: 'Restore bullet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Kept/ }));
    expect(screen.getByText('Human attested')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Uncovered/ }));
    expect(screen.getAllByRole('article', { name: /Uncovered unit/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add literal bullet' })[0]!);
    await waitFor(() => expect(screen.getByText(/1 literal bullet\(s\) added/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Internal/ }));
    expect(screen.getByRole('heading', { name: /Generation ledger/ })).toBeInTheDocument();
    expect(screen.getAllByText('synthetic-authored', { exact: false }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: 'v1.0.0' } });
    fireEvent.change(screen.getByLabelText('Release date'), { target: { value: '2026-10-24' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve release notes' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve release notes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: 'v1.0.1' } });
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled();
  });
  it('renders setup and live-unavailable states without presenting mock generation as live', () => {
    const { rerender } = render(<App mode={{ kind: 'setup', detail: 'Both public values are required.' }} />);
    expect(screen.getByText(/Both public values are required/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load example' })).not.toBeInTheDocument();
    // App mode is stable for a mounted session; a new mount represents a navigation/configuration change.
    rerender(<App key="live" mode={{ kind: 'live' }} />);
    expect(screen.getByText(/No live request has been made/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load example' })).not.toBeInTheDocument();
  });
  it('requires a nonblank reason before the restore form can submit', () => {
    const save = vi.fn();
    render(<ReviewDialog action={{ kind: 'restore', bullet: reviewBullet('low_support') }} disabled={false} onClose={vi.fn()} onSave={save} />);
    const button = screen.getByRole('button', { name: 'Restore bullet' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I checked the cited change.' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ text: 'CSV export escapes commas.' }), 'I checked the cited change.');
  });
});
