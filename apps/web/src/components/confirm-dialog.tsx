import { useState, type ReactNode } from 'react';
import { Modal } from './modal.js';
import { Button } from './button.js';

export type ConfirmTone = 'danger' | 'approve' | 'neutral';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'neutral',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const working = pending || busy;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      // Destructive: never close on a stray backdrop click.
      dismissOnScrim={false}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={working}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : tone === 'approve' ? 'approve' : 'primary'}
            onClick={handleConfirm}
            loading={working}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-text">{body}</div>
    </Modal>
  );
}
