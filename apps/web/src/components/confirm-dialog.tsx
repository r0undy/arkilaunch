import { useState, type ReactNode } from 'react';
import { Modal } from './modal.js';
import { Button } from './button.js';

// Every consequential action in the console fired on a single click, with no
// confirmation and, in the case of the role <select>, on a stray arrow key.
// This is the one gate they all now pass through.

export type ConfirmTone = 'danger' | 'approve' | 'neutral';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  // What the reader is agreeing to, in their own terms -- not a restatement
  // of the button they just pressed.
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
      // A destructive choice should take a deliberate click, never a stray
      // one on the backdrop.
      dismissOnScrim={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={working}>
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
      <div className="text-sm text-text">{body}</div>
    </Modal>
  );
}
