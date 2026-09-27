import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Copies a reference (booking code, serial number) so nobody retypes it into
// a call, a chat or another screen. Says what it copied for screen readers.
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
      <span className="sr-only" aria-live="polite">
        {copied ? `Copied ${value}` : `Copy ${label}`}
      </span>
    </button>
  );
}
