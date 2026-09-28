import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /** Keep the label for screen readers only (a compact row control). */
  labelHidden?: boolean;
  error?: string;
  hint?: ReactNode;
}

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

// The AWS reference's dropdown (DSD §4 Inputs): a square trigger with a
// caret, and a floating menu that lifts off the page, the highlighted row
// tinted, the chosen one in accent with a check. A native <select> opens the
// OS list, which cannot be styled, so this is a select-only combobox
// (WAI-ARIA APG).
//
// A real <select> stays in the DOM, hidden, and is the source of truth: it
// holds the <option> children, the forwarded ref, name, value, required and
// onChange. Picking sets its value and fires a real change event, so every
// caller (controlled, uncontrolled, FormData) works exactly as before.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, labelHidden, error, hint, id, className = '', required, disabled, children, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-listbox`;
  const optId = (i: number) => `${triggerId}-opt-${i}`;
  const errorId = error ? `${triggerId}-error` : undefined;

  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useImperativeHandle(ref, () => native.current!, []);

  const [opts, setOpts] = useState<Opt[]>([]);
  const [selected, setSelected] = useState(-1);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const typed = useRef({ text: '', at: 0 });

  // Mirror the native select after every render: its options and its
  // selection, whether a parent controls the value or not.
  function sync() {
    const el = native.current;
    if (!el) return;
    const next = Array.from(el.options, (o) => ({ value: o.value, label: o.text, disabled: o.disabled }));
    setOpts((prev) =>
      prev.length === next.length && prev.every((p, i) => p.value === next[i]!.value && p.label === next[i]!.label && p.disabled === next[i]!.disabled)
        ? prev
        : next,
    );
    setSelected(el.selectedIndex);
  }
  useLayoutEffect(() => sync());

  const enabled = (i: number) => opts[i] && !opts[i].disabled;
  function step(from: number, dir: 1 | -1, by = 1): number {
    let i = from;
    for (let moved = 0; moved < by; ) {
      const n = i + dir;
      if (n < 0 || n >= opts.length) break;
      i = n;
      if (enabled(i)) moved++;
    }
    return enabled(i) ? i : from;
  }
  const firstEnabled = () => opts.findIndex((o) => !o.disabled);
  const lastEnabled = () => opts.map((o) => !o.disabled).lastIndexOf(true);

  function openMenu(at?: number) {
    if (disabled) return;
    setActive(at ?? (enabled(selected) ? selected : firstEnabled()));
    setOpen(true);
  }

  function pick(i: number) {
    const el = native.current;
    setOpen(false);
    if (!el || !enabled(i)) return;
    if (el.selectedIndex !== i) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
  }

  // Type-ahead: letters typed within half a second build one search.
  function typeahead(key: string) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at < 500 ? t.text + key.toLowerCase() : key.toLowerCase();
    t.at = now;
    const from = open ? active : selected;
    const start = t.text.length === 1 ? from + 1 : Math.max(from, 0);
    const order = [...opts.keys()].map((k) => (start + k) % opts.length);
    const hit = order.find((i) => enabled(i) && opts[i]!.label.toLowerCase().startsWith(t.text));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else openMenu(hit);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) openMenu();
        else setActive(step(active, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      case 'PageDown':
      case 'PageUp':
        if (!open) return;
        e.preventDefault();
        setActive(step(active, e.key === 'PageDown' ? 1 : -1, 10));
        return;
      case 'Home':
      case 'End':
        if (!open) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? firstEnabled() : lastEnabled());
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) pick(active);
        else openMenu();
        return;
      case 'Escape':
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      case 'Tab':
        if (open) pick(active);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
    }
  }

  // Place the menu under the trigger (above it when the viewport runs out),
  // follow scrolling and resizing, and close on a press anywhere else.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < 200 && above > below;
      setPos({
        left: r.left,
        minWidth: r.width,
        maxWidth: Math.max(r.width, window.innerWidth - r.left - 8),
        maxHeight: Math.min(320, up ? above : below),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const current = opts[selected];
  // A value="" first option ("Any equipment", "Region") reads as a prompt.
  const isPrompt = !current || current.value === '';

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={triggerId} className={labelHidden ? 'sr-only' : 'text-sm font-medium text-text'}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <select ref={native} tabIndex={-1} aria-hidden="true" className="sr-only" required={required} disabled={disabled} {...rest}>
        {children}
      </select>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={[
          'flex min-h-11 w-full items-center justify-between gap-3 rounded-input border bg-surface px-4 py-2.5 text-left text-base',
          error ? 'border-error' : open ? 'border-accent' : 'border-border hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          'disabled:cursor-not-allowed disabled:bg-surface-sunk disabled:text-text-muted',
          className,
        ].join(' ')}
      >
        <span className={['min-w-0 truncate', isPrompt ? 'text-text-muted' : 'text-text'].join(' ')}>{current?.label ?? ''}</span>
        <ChevronDown aria-hidden className={['size-4 shrink-0 text-text-muted transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            style={pos}
            // Pressing inside the menu (an option, its scrollbar) must not
            // take focus off the trigger, which owns the keyboard.
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-[100] overflow-y-auto rounded-sm border border-border bg-surface py-1 shadow-lg"
          >
            {opts.map((o, i) => (
              <li
                key={`${i}-${o.value}`}
                id={optId(i)}
                role="option"
                data-value={o.value}
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                onPointerEnter={() => enabled(i) && setActive(i)}
                onClick={() => pick(i)}
                className={[
                  'flex min-h-11 items-center gap-3 border-l-2 px-4 text-base',
                  i === active ? 'bg-surface-sunk' : '',
                  i === selected ? 'border-accent font-medium text-accent' : 'border-transparent text-text',
                  o.disabled ? 'cursor-not-allowed text-text-muted' : 'cursor-pointer',
                ].join(' ')}
              >
                <span className={['min-w-0 flex-1 truncate', o.value === '' && i !== selected ? 'text-text-muted' : ''].join(' ')}>
                  {o.label}
                </span>
                {i === selected && <Check aria-hidden className="size-4 shrink-0" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {hint && !error && <p className="text-sm text-text-muted">{hint}</p>}
    </div>
  );
});
