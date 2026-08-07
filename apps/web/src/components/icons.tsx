import type { SVGProps } from 'react';

// Minimal inline icon set (no external icon library installed; DESIGN.md's status
// components need "icon + label", not a full icon system). Consistent 1.5 stroke.
type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10.5l3.5 3.5L16 6" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 7v4M10 13.5h.01M8.6 3.4a1.6 1.6 0 012.8 0l6 10.6a1.6 1.6 0 01-1.4 2.4H4a1.6 1.6 0 01-1.4-2.4l6-10.6z" />
    </svg>
  );
}

export function XCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.5 7.5l5 5m0-5l-5 5" />
    </svg>
  );
}

export function CloudIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 15.5a3.5 3.5 0 01-.5-6.96A4.5 4.5 0 0114 9a3 3 0 010 6H6z" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 13.5V6.5A1 1 0 013.5 5.5h6.5v8" />
      <path d="M10 8.5h3.2l2.3 2.6v2.4h-15.5" />
      <circle cx="6" cy="15" r="1.4" />
      <circle cx="13.5" cy="15" r="1.4" />
    </svg>
  );
}

export function WrenchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.5 3.5l-3 3 1 1 3-3a3 3 0 11-1 -1z" />
      <path d="M9.5 6.5L3.5 12.5a1.4 1.4 0 002 2l6-6" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6h14M3 10h14M3 14h14" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
