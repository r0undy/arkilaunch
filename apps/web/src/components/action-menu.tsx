import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 8 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = items.length * 44 + 8;
      setPosition({
        top: rect.bottom + height + 4 > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border-strong bg-surface text-text hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }}
          style={position}
          className="fixed z-50 min-w-48 rounded-sm border border-border bg-surface p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); trigger.current?.focus(); item.onSelect(); }}
              className={`flex min-h-11 w-full items-center rounded-sm px-3 text-left text-sm hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-40 ${item.destructive ? 'text-error' : 'text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>, document.body,
      )}
    </div>
  );
}
