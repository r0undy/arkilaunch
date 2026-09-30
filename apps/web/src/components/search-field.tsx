import { Search } from 'lucide-react';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Announced name; the placeholder shows only while empty. */
  label: string;
  placeholder?: string;
  /** compact: the 36px Cloudscape filter control; default: 44px for a page's main search. */
  size?: 'compact' | 'default';
  id?: string;
  maxLength?: number;
  className?: string;
}

// Cloudscape text filter: a magnifier inside the box, the label for screen readers only.
export function SearchField({ value, onChange, label, placeholder, size = 'compact', id, maxLength, className = '' }: SearchFieldProps) {
  const compact = size === 'compact';
  return (
    <div className={`relative ${className}`}>
      <Search
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted ${compact ? 'left-3 h-4 w-4' : 'left-4 h-5 w-5'}`}
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder ?? label}
        maxLength={maxLength}
        className={[
          'w-full rounded-input border border-border bg-surface text-text hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          compact ? 'min-h-9 py-1.5 pl-9 pr-3 text-sm' : 'min-h-11 py-2.5 pl-12 pr-4 text-base',
        ].join(' ')}
      />
    </div>
  );
}
