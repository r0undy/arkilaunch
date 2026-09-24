import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';

// The only overlay in the app was the sidebar drawer, which had no focus
// trap, no Escape handler and no dialog role. Long forms and every
// consequential action now open through this instead, so the accessibility
// work is done once.

export type ModalSize = 'sm' | 'md' | 'lg';

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
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissOnScrim = true,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      // Keep Tab inside the dialog, so focus cannot wander onto the page
      // behind it while it is open.
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
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
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusable && focusable.length > 0 ? focusable[0] : panel.current)?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = overflow;
      restoreFocusTo.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-[var(--yb-modal-scrim)]"
        onClick={dismissOnScrim ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description ? { 'aria-describedby': descriptionId } : {})}
        tabIndex={-1}
        className={[
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-lg border border-border bg-surface shadow-lg sm:rounded-lg',
          SIZE_CLASSES[size],
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold text-text">
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
            className="-m-1 shrink-0 rounded-sm p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <CloseIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4 sm:p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
