import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'approve';
export type ButtonSize = 'default' | 'field';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-sunk',
  ghost: 'bg-transparent text-text hover:bg-surface-sunk',
  destructive: 'bg-error text-white hover:bg-error-hover',
  approve: 'bg-success text-white hover:bg-success-hover',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'min-h-11 px-6 py-2.5',
  field: 'min-h-12 px-6 py-3',
};

// For a <Link> or <a> that looks like a button: never nest a <button> in an <a>.
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'default', className = ''): string {
  return [
    'inline-flex min-w-11 items-center justify-center gap-2 rounded-pill font-sans text-sm font-medium',
    'transition-colors duration-[120ms] ease-out',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-40',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ].join(' ');
}

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
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <>
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
