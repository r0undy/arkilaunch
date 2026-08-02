import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

// Shares the Inputs & Forms spec (DESIGN.md §4): label above field, 1px border,
// radius-sm, 2px/2px-offset focus ring, 44px min touch height.
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, id, className = '', required, children, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-text">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={[
          'block min-h-11 w-full rounded-sm border bg-surface px-3.5 py-3 text-base text-text',
          error ? 'border-error' : 'border-border hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {hint && !error && <p className="text-sm text-text-muted">{hint}</p>}
    </div>
  );
});
