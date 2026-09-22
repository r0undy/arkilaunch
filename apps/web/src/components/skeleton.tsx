// Pulsing placeholder while a query is pending (DESIGN.md §4.1 loading
// state). `label` is what a screen reader hears instead of the blocks.
export function Skeleton({
  label,
  rows = 3,
  className = '',
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={`flex flex-col gap-3 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-16 animate-pulse rounded-md bg-border/60" />
      ))}
    </div>
  );
}
