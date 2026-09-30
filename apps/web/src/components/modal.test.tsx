import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './modal.js';
import { ConfirmDialog } from './confirm-dialog.js';

describe('Modal', () => {
  it('exposes itself as a dialog named by its title', () => {
    render(
      <Modal open onClose={() => undefined} title="Record a field log">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Record a field log' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => undefined} title="Hidden">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Closable">
        <p>body</p>
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a busy dialog open', async () => {
    const onClose = vi.fn();
    render(
      <Modal open closeDisabled onClose={onClose} title="Submitting company">
        <input aria-label="Company name" />
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  // Cloudscape Modal: focus opens on the first field, never the dismiss X.
  it('opens with focus on the first field', () => {
    render(
      <Modal open onClose={() => undefined} title="Add a coupon" footer={<button type="button">Save</button>}>
        <label>
          Code <input />
        </label>
      </Modal>,
    );
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveFocus();
  });
});

describe('ConfirmDialog', () => {
  it('does not act until the confirm button is pressed', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Bill these hours?"
        body={<p>This takes money from a deposit.</p>}
        confirmLabel="Yes, bill them"
        tone="approve"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, bill them' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancelling never confirms', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Remove access?"
        body={<p>They will be signed out.</p>}
        confirmLabel="Remove access"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('is an alert dialog that opens on Cancel, the safe choice', () => {
    render(
      <ConfirmDialog
        open
        title="Delete coupon?"
        body={<p>Customers can no longer use it.</p>}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete coupon?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
