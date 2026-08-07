import { useId, useState, type ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

// DESIGN.md §6 bans hover-only affordances, so this opens on hover AND
// keyboard focus (never just one), closes on Escape or blur, and is wired
// with role="tooltip" + aria-describedby so a screen reader announces it.
// Generic trigger/content split -- not weather-specific.
export function Tooltip({ content, children, className = '' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      data-testid="tooltip-root"
      className={['relative inline-flex', className].join(' ')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <span aria-describedby={open ? id : undefined} tabIndex={0} className="inline-flex cursor-help outline-none">
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-md border border-border-strong bg-surface p-3 text-xs text-text shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  );
}
