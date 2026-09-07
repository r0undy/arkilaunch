import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, CloudRain, ExternalLink, Info, XCircle } from 'lucide-react';
import { Tooltip } from './tooltip.js';

export type WeatherTone = 'clear' | 'yellow' | 'orange' | 'red' | 'stale';

export interface WeatherBannerProps {
  tone: WeatherTone;
  /** Plain-English headline, e.g. "Weather watch" or "Severe weather warning". */
  severityLabel: string;
  /** Small secondary tag alongside the headline, e.g. "PAGASA yellow". Omit for a tone with no PAGASA equivalent. */
  tagLabel?: string;
  siteName: string;
  condition: string;
  /** Relative text shown inline ("Reported 3 hours ago"); the exact date/time goes on the element's hover title. */
  timestamp: { relative: string; absolute: string } | null;
  /** Plain-English lines explaining the actual observed readings behind this severity (see lib/weather-explain.ts). Omit if no reading is available yet. */
  breakdown?: string[];
  /** Site coordinates, used to build the "View live map" link. Omit to hide the link. */
  coordinates?: { latitude: number; longitude: number };
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

const TONE_ICON: Record<WeatherTone, typeof CheckCircle2> = {
  clear: CheckCircle2,
  yellow: AlertTriangle,
  orange: CloudRain,
  red: XCircle,
  stale: Clock,
};

function windyUrl(latitude: number, longitude: number): string {
  // windy.com's own URL scheme: /?lat,lon,zoom -- centers the live radar
  // map on the exact site, not a generic landing page.
  return `https://www.windy.com/?${latitude},${longitude},11`;
}

// CC BY 4.0 requires attribution wherever Open-Meteo's data is displayed
// (docs/cr-arkilaunch-open-meteo-free-tier.md). Rendered unconditionally --
// not gated on `coordinates` or on a reading existing -- because this
// banner is the one surface that shows Open-Meteo-derived values, and
// under-attributing costs a licence breach where over-attributing costs one
// line of text.
const OPEN_METEO_URL = 'https://open-meteo.com/';

// Full-width strip driven by the PAGASA weather scale (DESIGN.md §4/§4.1).
// Leads with a plain-English headline so it's readable without knowing the
// PAGASA scale, keeps the PAGASA tag as a secondary chip so it still carries
// the locally-recognized signal (BRAND.md §0), and stacks site/condition/time
// onto their own lines instead of one run-on row. Never color-only; never
// fabricates a timestamp -- an unknown reading says so instead of "today".
// The breakdown tooltip and map link make the conclusion checkable, not just
// asserted (BRAND.md: protective of the user's trust, evidence-first).
export function WeatherBanner({
  tone,
  severityLabel,
  tagLabel,
  siteName,
  condition,
  timestamp,
  breakdown,
  coordinates,
  action,
  className = '',
}: WeatherBannerProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={[
        'flex w-full flex-wrap items-start justify-between gap-3 rounded-md px-4 py-3 text-sm',
        TONE_CLASSES[tone],
        className,
      ].join(' ')}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" />
          <span className="font-semibold">{severityLabel}</span>
          {tagLabel && (
            <span className="rounded-sm bg-black/10 px-1.5 py-0.5 text-xs font-medium uppercase tracking-[0.04em]">
              {tagLabel}
            </span>
          )}
          {breakdown && breakdown.length > 0 && (
            <Tooltip
              content={
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-text-muted">Why this reading</p>
                  <ul className="flex flex-col gap-1">
                    {breakdown.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              }
            >
              <Info className="h-4 w-4 opacity-80" aria-label="Why this reading" />
            </Tooltip>
          )}
        </div>
        <p>
          <span className="font-semibold">{siteName}</span>
          {' — '}
          {condition}
        </p>
        <p className="font-mono text-xs tabular-nums opacity-90" title={timestamp?.absolute}>
          {timestamp ? timestamp.relative : 'Time unknown'}
        </p>
        {coordinates && (
          <a
            href={windyUrl(coordinates.latitude, coordinates.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium underline decoration-dotted"
          >
            View live map <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">(opens a live weather map for this site in a new tab)</span>
          </a>
        )}
        <a
          href={OPEN_METEO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium underline decoration-dotted opacity-80"
        >
          Weather data by Open-Meteo.com (CC BY 4.0) <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens Open-Meteo's site in a new tab)</span>
        </a>
      </div>
      {action}
    </div>
  );
}
