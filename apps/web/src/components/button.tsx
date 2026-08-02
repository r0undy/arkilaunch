import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'approve';
export type ButtonSize = 'default' | 'field';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-text hover:bg-primary-hover',
  secondary: 'border border-accent bg-transparent text-accent hover:bg-surface-sunk',
  ghost: 'bg-transparent text-text hover:bg-surface-sunk',
  destructive: 'bg-error text-white hover:bg-error-hover',
  approve: 'bg-success text-white hover:bg-success-hover',
};

// DESIGN.md §4 Buttons: 44x44px min everywhere, 48x48px on the timekeeper console / field actions.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'min-h-11 px-5 py-3',
  field: 'min-h-12 px-5 py-3.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'default', loading = false, disabled, className = '', children, type, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex min-w-11 items-center justify-center gap-2 rounded-sm font-sans text-[15px] font-semibold',
        'transition-colors duration-[120ms] ease-out',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <>
          {/* animate-spin freezes under the global prefers-reduced-motion override (index.css) */}
          <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Working...
        </>
      ) : (
        children
      )}
    </button>
  );
});
