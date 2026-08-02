import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  error?: string;
  numeric?: boolean;
  size?: 'default' | 'field';
  hint?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, numeric = false, size = 'default', hint, id, className = '', required, inputMode, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        inputMode={numeric ? 'decimal' : inputMode}
        className={[
          'block w-full rounded-sm border bg-surface px-3.5 py-3 text-base text-text',
          size === 'field' ? 'min-h-12' : 'min-h-11',
          numeric ? 'text-right font-mono tabular-nums' : '',
          error ? 'border-error' : 'border-border hover:border-border-strong',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          className,
        ].join(' ')}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-sm text-error">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l6.06 10.79c.75 1.334-.213 2.986-1.743 2.986H3.939c-1.53 0-2.493-1.652-1.743-2.986l6.06-10.79zM10 7a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1zm0 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-sm text-text-muted">{hint}</p>}
    </div>
  );
});
