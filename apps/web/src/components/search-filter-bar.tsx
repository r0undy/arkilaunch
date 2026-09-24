export interface SearchFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
}

// Search only. The availability pills (All / Available / Deployed / In
// maintenance) are gone: the customer side shows what can be rented and
// labels nothing, so there is no status left to filter by.
export function SearchFilterBar({ query, onQueryChange }: SearchFilterBarProps) {
  return (
    <input
      type="search"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder="Search equipment"
      aria-label="Search equipment"
      className="min-h-11 w-full rounded-mk-sm border border-border bg-surface-mk px-4 py-2 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    />
  );
}
