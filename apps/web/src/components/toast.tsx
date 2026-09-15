import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertIcon, CheckIcon, XCircleIcon } from './icons.js';

// Until now a successful mutation produced no visible response at all -- a
// deduction, a role change and a retired rate card all looked identical to
// nothing happening. Toasts give every write an acknowledgement.
//
// Hand-rolled rather than pulled from a library: the app has no headless-UI
// dependency and this needs ~80 lines. Announced through an aria-live region
// so the acknowledgement is not sighted-only.

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly detail?: string;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Errors stay put: a failure the reader misses is worse than one they
// dismiss. Confirmations clear themselves.
const DISMISS_AFTER_MS: Record<ToastTone, number | null> = {
  success: 5000,
  info: 5000,
  error: null,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-success text-success',
  error: 'border-error text-error',
  info: 'border-accent text-accent',
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckIcon className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === 'error') return <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />;
  return <AlertIcon className="h-5 w-5 shrink-0" aria-hidden />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      dismiss,
      success: (title, detail) => show({ tone: 'success', title, ...(detail ? { detail } : {}) }),
      error: (title, detail) => show({ tone: 'error', title, ...(detail ? { detail } : {}) }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // polite, not assertive: a confirmation should not interrupt what a
        // screen reader is already saying.
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const after = DISMISS_AFTER_MS[toast.tone];
    if (after === null) return;
    const timer = setTimeout(() => onDismiss(toast.id), after);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div
      className={[
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border bg-surface p-3 shadow-md',
        TONE_CLASSES[toast.tone],
      ].join(' ')}
    >
      <ToastIcon tone={toast.tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{toast.title}</p>
        {toast.detail && <p className="mt-0.5 text-sm text-text-muted">{toast.detail}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="-m-1 shrink-0 rounded-sm p-1 text-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <XCircleIcon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
