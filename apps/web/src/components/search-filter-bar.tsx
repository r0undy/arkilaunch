export type SortOption = 'new' | 'price-asc' | 'price-desc' | 'rating';

export interface SearchFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'price-asc', label: 'Price ascending' },
  { value: 'price-desc', label: 'Price descending' },
  { value: 'rating', label: 'Rating' },
];

// The Figma search bar + sort-toggle row above the catalog grid.
export function SearchFilterBar({ query, onQueryChange, sort, onSortChange }: SearchFilterBarProps) {
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
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSortChange(opt.value)}
            aria-pressed={sort === opt.value}
            className={[
              'min-h-11 rounded-pill px-4 py-2 text-sm font-medium transition-colors',
              sort === opt.value ? 'bg-ink-mk text-text-inverse' : 'bg-surface-mk text-text-muted hover:text-text',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
