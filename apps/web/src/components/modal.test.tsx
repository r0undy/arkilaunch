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
});
