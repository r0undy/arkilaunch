import { useId, useRef, type KeyboardEvent } from 'react';

// The one tablist (it was hand-built three times). Arrow keys, Home and End
// move between tabs and select them; only the selected tab is in the Tab
// order, per the ARIA tabs pattern. Callers render the panel themselves,
// wrapped in role="tabpanel".

export interface TabItem<T extends string> {
  id: T;
  label: string;
  // A count beside the label (open requests, pending logs). 0/null hides it.
  badge?: number | null;
}

export interface TabsProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
}

export function Tabs<T extends string>({ label, items, value, onChange }: TabsProps<T>) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.id);
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={`${base}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={[
'-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
              selected ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text',
            ].join(' ')}
          >
            {item.label}
            {item.badge ? (
              <span className="rounded-xs bg-surface-sunk px-1.5 py-0.5 font-mono text-xs tabular-nums text-text">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
