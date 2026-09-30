export interface Segment<T extends string> {
  id: T;
  label: string;
  count?: number | null | undefined;
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group for screen readers. */
  label: string;
  items: Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

// Cloudscape segmented control: joined square segments, the chosen one filled. Wraps on a phone.
export function SegmentedControl<T extends string>({ label, items, value, onChange, className = '' }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap ${className}`}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id || 'all'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(item.id)}
            className={[
              '-ml-px min-h-9 border px-3 text-sm first:ml-0 first:rounded-l-sm last:rounded-r-sm',
              'focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring',
              on
                ? 'relative z-[1] border-accent bg-accent font-semibold text-white'
                : 'border-border-strong bg-surface text-text hover:bg-surface-sunk',
            ].join(' ')}
          >
            {item.label}
            {item.count != null && (
              <span className={`ml-1.5 tabular-nums ${on ? '' : 'text-text-muted'}`}>({item.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
