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
import { createPortal } from 'react-dom';
import { Check, CircleX, Info, TriangleAlert, X } from 'lucide-react';

// Until now a successful mutation produced no visible response at all -- a
// deduction, a role change and a retired rate card all looked identical to
// nothing happening. Toasts give every write an acknowledgement.
//
// Hand-rolled rather than pulled from a library: the app has no headless-UI
// dependency and this needs ~80 lines. Announced through an aria-live region
// so the acknowledgement is not sighted-only.

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

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
  info: (title: string, detail?: string) => void;
  warning: (title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
// The shell's Flashbar slot (AWS Console): toasts render there, at the top of
// the content column, when a shell has mounted one.
const SlotContext = createContext<(el: HTMLElement | null) => void>(() => {});

// Errors stay put: a failure the reader misses is worse than one they
// dismiss. Confirmations clear themselves.
const DISMISS_AFTER_MS: Record<ToastTone, number | null> = {
  success: 5000,
  info: 5000,
  warning: 5000,
  error: null,
};

// Filled bars (Cloudscape Flashbar). White text: 5.4:1 on success, 5.6:1 on
// error, 6.8:1 on accent. Warning yellow takes dark text.
const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'bg-success text-white',
  error: 'bg-error text-white',
  info: 'bg-accent text-white',
  warning: 'bg-warning text-text',
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <Check className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === 'error') return <CircleX className="h-5 w-5 shrink-0" aria-hidden />;
  if (tone === 'warning') return <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />;
  return <Info className="h-5 w-5 shrink-0" aria-hidden />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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
      info: (title, detail) => show({ tone: 'info', title, ...(detail ? { detail } : {}) }),
      warning: (title, detail) => show({ tone: 'warning', title, ...(detail ? { detail } : {}) }),
    }),
    [show, dismiss],
  );

  const region = (
    <div
      // polite, not assertive: a confirmation should not interrupt what a
      // screen reader is already saying.
      aria-live="polite"
      aria-atomic="false"
      className="flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      <SlotContext.Provider value={setSlot}>{children}</SlotContext.Provider>
      {slot ? (
        createPortal(region, slot)
      ) : (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 p-4">{region}</div>
      )}
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  // The timer holds while the pointer or focus is on the bar, so a message
  // being read (or its dismiss button reached by keyboard) does not vanish.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const after = DISMISS_AFTER_MS[toast.tone];
    if (after === null || held) return;
    const timer = setTimeout(() => onDismiss(toast.id), after);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss, held]);

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={[
'pointer-events-auto flex w-full items-start gap-3 rounded-sm px-4 py-3 shadow-md',
        TONE_CLASSES[toast.tone],
      ].join(' ')}
    >
      <ToastIcon tone={toast.tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.detail && <p className="mt-0.5 text-sm opacity-90">{toast.detail}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="-my-2.5 -mr-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}

// Sits at the top of a shell's content column; sticky flush under the 56px bar.
export function FlashbarSlot() {
  const setSlot = useContext(SlotContext);
  return <div ref={setSlot} className="sticky top-14 z-50 [&_[aria-live]:not(:empty)]:mb-4" />;
}
