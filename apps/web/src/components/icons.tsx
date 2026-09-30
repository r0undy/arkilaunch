import type { SVGProps } from 'react';

// lucide-react dropped its brand icons.
export function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="14" height="14" rx="3" />
      <path d="M12.5 7h-1.25A1.75 1.75 0 009.5 8.75V17M8 11h4" />
    </svg>
  );
}
