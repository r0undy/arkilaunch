import { SearchField } from './search-field.js';

export interface SearchFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function SearchFilterBar({ query, onQueryChange }: SearchFilterBarProps) {
  return <SearchField size="default" value={query} onChange={onQueryChange} label="Search equipment" />;
}
