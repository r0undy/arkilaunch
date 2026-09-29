import { useState, type ReactNode } from 'react';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import { useTenant } from '../lib/tenant.js';
import { Button, type ButtonVariant } from './button.js';
import { Modal } from './modal.js';

export function NegotiateChoice({
  onInApp,
  variant = 'primary',
  children = 'Negotiate via messenger',
}: {
  onInApp: () => void;
  variant?: ButtonVariant;
  children?: ReactNode;
}) {
  const messengerUrl = useTenant()?.messengerUrl ?? null;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => (messengerUrl ? setOpen(true) : onInApp())}>
        {children}
      </Button>
      {messengerUrl && (
        <Modal open={open} onClose={() => setOpen(false)} title="Where do you want to negotiate?" size="sm">
          <div className="flex flex-col gap-3">
            <a
              href={messengerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 text-left hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <MessageCircle aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">Facebook Messenger</span>
                <span className="text-xs text-text-muted">Opens the rental company's Messenger in a new tab.</span>
              </span>
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onInApp();
              }}
              className="flex min-h-14 items-center gap-3 rounded-md border border-border px-4 text-left hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <MessagesSquare aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">In-app chat</span>
                <span className="text-xs text-text-muted">
                  Stays on the booking, next to the price. Agreed prices are only binding once set here.
                </span>
              </span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
