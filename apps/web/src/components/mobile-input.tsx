import { useEffect, useId, useRef, useState } from 'react';
import { localPhMobile, normalizePhMobile, PH_MOBILE_REGEX } from '@arkilaunch/shared';

export interface MobileInputProps {
  label: string;
  /** The stored number, +639XXXXXXXXX, or '' when empty. */
  value: string;
  /** Called with +639XXXXXXXXX (or +63 plus whatever digits were typed, which the schema refuses), '' when cleared. */
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  error?: string | undefined;
}

// Every contact-mobile field: a fixed +63 the customer cannot edit, then the
// 10-digit number. A pasted 0917…, 63917… or +63 917… lands the same way.
// The browser refuses to submit the form until it is a PH mobile.
export function MobileInput({ label, value, onChange, required, hint = 'e.g. 917 123 4567', error }: MobileInputProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => localPhMobile(value));
  const valid = value === '' ? !required : PH_MOBILE_REGEX.test(value);

  // A value set from outside (a loaded profile) replaces what is shown.
  useEffect(() => {
    if (value !== (text.replace(/\D/g, '') ? normalizePhMobile(text) : '')) setText(localPhMobile(value));
    // Only an outside change of value rewrites the text, so text is not a dependency.
  }, [value]);

  useEffect(() => {
    ref.current?.setCustomValidity(valid ? '' : 'Enter a PH mobile number, e.g. 917 123 4567');
  }, [valid]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div className={`flex min-h-11 w-full items-stretch overflow-hidden rounded-input border bg-surface ${error ? 'border-error' : 'border-border hover:border-border-strong'} focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring`}>
        <span aria-hidden="true" className="flex items-center border-r border-border bg-surface-sunk px-3 font-mono text-base text-text-muted">
          +63
        </span>
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required={required}
          maxLength={20}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          className="block w-full min-w-0 bg-transparent px-3 py-2.5 font-mono text-base text-text outline-none"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.replace(/\D/g, '') ? normalizePhMobile(e.target.value) : '');
          }}
          onBlur={() => {
            const local = localPhMobile(value);
            if (local) setText(local);
          }}
        />
      </div>
      <p id={`${id}-hint`} role={error ? 'alert' : undefined} className={`text-sm ${error ? 'text-error' : 'text-text-muted'}`}>
        {error ?? hint}
      </p>
    </div>
  );
}
