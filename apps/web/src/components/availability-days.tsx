import { useQuery } from '@tanstack/react-query';
import type { AvailabilityResponse } from '@arkilaunch/shared';
import { apiGet } from '../lib/api-client.js';
import { getAccessToken } from '../lib/auth-client.js';

const DAYS_AHEAD = 60;
const REASON: Record<string, string> = {
  assignment: 'Booked',
  maintenance: 'Maintenance',
  closed: 'Closed',
  holiday: 'Holiday',
  operator: 'No operator',
};

// Local YYYY-MM-DD. The API speaks Manila dates.
// ponytail: assumes the browser is on Manila time (every customer today);
// pass a timezone to the API if the yard ever books across zones.
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Free/taken days for the next DAYS_AHEAD days. Signed-out visitors get
// nothing (the endpoint is authenticated); the server check still guards.
export function useAvailability(equipmentId: string) {
  const from = localDate(new Date());
  const to = localDate(new Date(Date.now() + (DAYS_AHEAD - 1) * 86_400_000));
  return useQuery({
    queryKey: ['equipment', equipmentId, 'availability', from] as const,
    queryFn: () => apiGet<AvailabilityResponse>(`/equipment/${equipmentId}/availability?from=${from}&to=${to}`),
    enabled: Boolean(getAccessToken()),
  });
}

// The first unavailable day the window touches, or null. Also checks the
// pickup/return times against business hours.
export function availabilityProblem(data: AvailabilityResponse | undefined, startIso: string, endIso: string): string | null {
  if (!data || !startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const first = localDate(start);
  const last = localDate(end);
  const taken = data.days.find((d) => !d.available && d.date >= first && d.date <= last);
  if (taken) return `${taken.date} is not available (${(REASON[taken.reason ?? ''] ?? 'taken').toLowerCase()}).`;
  if (data.hours) {
    const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const { openTime, closeTime } = data.hours;
    if ([start, end].some((d) => hm(d) < openTime || hm(d) > closeTime)) {
      return `Pickup and return must be between ${openTime} and ${closeTime}.`;
    }
  }
  return null;
}

// A day grid: taken days are disabled, the chosen window is highlighted,
// clicking a free day moves the pickup to it.
export function AvailabilityDays({
  data,
  start,
  end,
  onPick,
}: {
  data: AvailabilityResponse | undefined;
  start: string;
  end: string;
  onPick: (date: string) => void;
}) {
  if (!data) return null;
  const first = start ? localDate(new Date(start)) : '';
  const last = end ? localDate(new Date(end)) : '';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">
        Availability, next {data.days.length} days
        {data.hours ? ` · open ${data.hours.openTime}–${data.hours.closeTime}` : ''}
      </p>
      <div role="group" aria-label="Available dates" className="grid grid-cols-7 gap-1">
        {data.days.map((d) => {
          const chosen = d.date >= first && d.date <= last;
          const label = `${d.date}${d.available ? '' : ` ${REASON[d.reason ?? ''] ?? 'Taken'}`}`;
          return (
            <button
              key={d.date}
              type="button"
              disabled={!d.available}
              aria-label={label}
              aria-pressed={chosen}
              title={label}
              onClick={() => onPick(d.date)}
              className={[
                'min-h-9 rounded-sm border text-xs tabular-nums',
                !d.available
                  ? 'cursor-not-allowed border-border bg-surface-sunk text-text-muted line-through'
                  : chosen
                    ? 'border-accent bg-accent text-white'
                    : 'border-border text-text hover:border-accent',
              ].join(' ')}
            >
              {Number(d.date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
