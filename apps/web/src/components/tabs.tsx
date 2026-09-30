import { useId, useRef, type KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
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

  // The baseline is an inset shadow, not a border the tabs overlap: nothing spills, so no stray scrollbar.
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
'inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
              selected ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text',
            ].join(' ')}
          >
            {item.label}
            {/* Cloudscape counter: a plain "(13)", not a chip. */}
            {item.badge ? <span className="font-normal tabular-nums text-text-muted">({item.badge})</span> : null}
          </button>
        );
      })}
    </div>
  );
}
