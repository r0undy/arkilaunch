export interface SearchFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function SearchFilterBar({ query, onQueryChange }: SearchFilterBarProps) {
  return (
    <input
      type="search"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      placeholder="Search equipment"
      aria-label="Search equipment"
      className="min-h-11 w-full rounded-input border border-border bg-surface px-4 py-2 text-base text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    />
  );
}
