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
//
// Two distinct layouts, not one row squeezed smaller: below sm, the search
// box takes the full width on its own line and the four pills sit in a
// 2-column grid, each filling its cell -- no horizontal scrollbar to
// discover, no wrapped-and-orphaned "In maintenance" pill. sm+ reverts to a
// single row with auto-width pills pinned to the far edge.
export function SearchFilterBar({ query, onQueryChange, availability, onAvailabilityChange }: SearchFilterBarProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search equipment"
        aria-label="Search equipment"
        className="min-h-11 w-full flex-1 rounded-mk-sm border border-border bg-surface-mk px-4 py-2 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap">
        {AVAILABILITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onAvailabilityChange(opt.value)}
            aria-pressed={availability === opt.value}
            className={[
              'min-h-11 w-full rounded-pill border px-4 py-2 text-sm font-medium transition-colors sm:w-auto',
              availability === opt.value
                ? 'border-primary bg-primary text-text'
                : 'border-border bg-surface-mk text-text-muted hover:text-text',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
