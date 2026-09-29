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
}

const ToastContext = createContext<ToastContextValue | null>(null);
const SlotContext = createContext<(el: HTMLElement | null) => void>(() => {});

const DISMISS_AFTER_MS: Record<ToastTone, number | null> = {
  success: 5000,
  info: 5000,
  warning: 5000,
  error: null,
};

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
      success: (title, detail) => show({ tone: 'success', title, ...(detail ? { detail } : {}) }),
      error: (title, detail) => show({ tone: 'error', title, ...(detail ? { detail } : {}) }),
    }),
    [show],
  );

  const region = (
    <div
      // polite: a confirmation should not interrupt the screen reader.
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
  // Hold the timer while pointer or focus is on the bar, so a message being read never vanishes.
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

export function FlashbarSlot() {
  const setSlot = useContext(SlotContext);
  return <div ref={setSlot} className="sticky top-14 z-50 [&_[aria-live]:not(:empty)]:mb-4" />;
}
