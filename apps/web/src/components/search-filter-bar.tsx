export type AvailabilityFilter = 'all' | 'available' | 'deployed' | 'maintenance';

export interface SearchFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  availability: AvailabilityFilter;
  onAvailabilityChange: (value: AvailabilityFilter) => void;
}

const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'maintenance', label: 'In maintenance' },
];

// Search + a real availability filter, backed by CatalogEquipmentSchema's
// actual `availabilityStatus` field -- no price/rating fields exist on the
// catalog contract, so this no longer pretends to sort by either.
export function SearchFilterBar({ query, onQueryChange, availability, onAvailabilityChange }: SearchFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search equipment"
        aria-label="Search equipment"
        className="min-h-11 min-w-[240px] flex-1 rounded-mk-sm border border-border bg-surface-mk px-4 py-2 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      />
      <div className="flex flex-wrap gap-2">
        {AVAILABILITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onAvailabilityChange(opt.value)}
            aria-pressed={availability === opt.value}
            className={[
              'min-h-11 rounded-pill px-4 py-2 text-sm font-medium transition-colors',
              availability === opt.value
                ? 'bg-ink-mk text-text-inverse'
                : 'bg-surface-mk text-text-muted hover:text-text',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
