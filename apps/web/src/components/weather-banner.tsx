import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, ClockIcon, XCircleIcon } from './icons.js';

export type WeatherTone = 'clear' | 'yellow' | 'orange' | 'red' | 'stale';

export interface WeatherBannerProps {
  tone: WeatherTone;
  siteName: string;
  condition: string;
  timestamp: string;
  action?: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<WeatherTone, string> = {
  clear: 'bg-weather-clear text-white',
  yellow: 'bg-weather-yellow text-text',
  orange: 'bg-weather-orange text-text',
  red: 'bg-weather-red text-white',
  stale: 'bg-weather-stale text-white',
};

const TONE_LABEL: Record<WeatherTone, string> = {
  clear: 'Clear',
  yellow: 'PAGASA yellow',
  orange: 'PAGASA orange',
  red: 'PAGASA red',
  stale: 'Stale reading',
};

const TONE_ICON: Record<WeatherTone, typeof CheckIcon> = {
  clear: CheckIcon,
  yellow: AlertIcon,
  orange: AlertIcon,
  red: XCircleIcon,
  stale: ClockIcon,
};

// Full-width strip driven by the PAGASA weather scale (DESIGN.md §4/§4.1): site name,
// condition, timestamp, and a stale marker when cached. A cached reading renders as
// the dedicated `stale` tone rather than keeping its last-known severity color.
export function WeatherBanner({ tone, siteName, condition, timestamp, action, className = '' }: WeatherBannerProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={[
        'flex w-full flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3 text-sm font-medium',
        TONE_CLASSES[tone],
        className,
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5 shrink-0" />
        <span className="font-semibold">{TONE_LABEL[tone]}</span>
        <span>{siteName}</span>
        <span>{condition}</span>
        <span className="font-mono tabular-nums opacity-90">{timestamp}</span>
      </div>
      {action}
    </div>
  );
}
