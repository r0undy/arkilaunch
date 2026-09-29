import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// The only overlay in the app was the sidebar drawer, which had no focus
// trap, no Escape handler and no dialog role. Long forms and every
// consequential action now open through this instead, so the accessibility
// work is done once.

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  // A destructive confirmation should not be dismissible by a stray click on
  // the scrim; an informational form should be.
  dismissOnScrim?: boolean;
  // 'right' is a full-height drawer from the right edge (the booking
  // drawer); same dialog semantics, focus trap and Escape handling.
  placement?: 'center' | 'right';
  // 'alertdialog' for a confirm that interrupts to ask (ConfirmDialog).
  role?: 'dialog' | 'alertdialog';
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Skips what Tab never reaches: the hidden native <select> behind a
// dropdown (tabIndex -1) and anything in a closed <details> or [hidden].
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], details:not([open]) > :not(summary)'),
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissOnScrim = true,
  placement = 'center',
  role = 'dialog',
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Callers pass inline arrows. Read through a ref so a re-render does not
  // re-run the open effect -- that re-focused the first control (and
  // re-bound the keys) on every keystroke in a form inside the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Only the dialog that holds focus answers. A confirm opened from
      // inside a drawer owns Escape and Tab; otherwise one Escape closed
      // both, and the drawer's trap pulled focus out of the confirm.
      const active = document.activeElement;
      if (!panel.current || !(active instanceof Element) || active.closest('[role="dialog"], [role="alertdialog"]') !== panel.current) return;
      // An open dropdown (components/select.tsx) owns its own Escape: it
      // closes the menu, not the dialog around it.
      if (event.key === 'Escape' && active.getAttribute('role') === 'combobox' && active.getAttribute('aria-expanded') === 'true') return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      // Keep Tab inside the dialog, so focus cannot wander onto the page
      // behind it while it is open.
      const focusable = focusables(panel.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    // A dialog nested inside this one (its effect runs first) may already
    // hold focus; leave it there. Otherwise open on the first field, else the
    // first footer action (Cancel in a confirm), never the dismiss X
    // (Cloudscape Modal).
    if (!panel.current?.contains(document.activeElement)) {
      (focusables(body.current)[0] ?? focusables(foot.current)[0] ?? panel.current)?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = overflow;
      restoreFocusTo.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className={
 placement ==='right'
          ? 'fixed inset-0 z-40 flex justify-end'
          : 'fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4'
      }
    >
      <div
        className="absolute inset-0 bg-[var(--yb-modal-scrim)]"
        onClick={dismissOnScrim ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description ? { 'aria-describedby': descriptionId } : {})}
        tabIndex={-1}
        className={[
 placement ==='right'
            ? 'relative flex h-dvh w-full flex-col border-l border-border bg-surface shadow-lg'
            : 'relative flex max-h-[90dvh] w-full flex-col rounded-t-md border border-border bg-surface shadow-lg sm:rounded-md',
          SIZE_CLASSES[size],
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-heading-lg text-text">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-sunk hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </div>

        {footer && (
          <div ref={foot} className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4 sm:p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
