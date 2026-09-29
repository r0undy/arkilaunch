import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function ExpandableSection({
  header,
  defaultOpen = false,
  children,
  className = '',
}: {
  header: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={['group', className].join(' ')}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-heading-md text-text hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 transition-transform duration-[120ms] group-open:rotate-90" />
        {header}
      </summary>
      <div className="pb-1 pl-6 pt-2">{children}</div>
    </details>
  );
}
