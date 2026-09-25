import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

function availabilityQuery(equipmentId: string, from: string, to: string) {
  return {
    queryKey: ['equipment', equipmentId, 'availability', from, to] as const,
    queryFn: () => apiGet<AvailabilityResponse>(`/equipment/${equipmentId}/availability?from=${from}&to=${to}`),
  };
}

// Free/taken days from today through the chosen return (at least
// DAYS_AHEAD days), so a booking of any length is checked end to end.
// Signed-out visitors get nothing (the endpoint is authenticated); the
// server check still guards.
export function useAvailability(equipmentId: string, end?: string) {
  const from = localDate(new Date());
  const minTo = localDate(new Date(Date.now() + (DAYS_AHEAD - 1) * 86_400_000));
  const endDate = end ? localDate(new Date(end)) : '';
  return useQuery({
    ...availabilityQuery(equipmentId, from, endDate > minTo ? endDate : minTo),
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1;
const prettyDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

// A month calendar for the rental span: the first click sets pickup, the
// second sets return (the span previews on hover), the next click starts
// over. Pages month by month with no limit; past and taken days are
// disabled. Each visible month reads its own availability.
export function RangeCalendar({
  equipmentId,
  start,
  end,
  onRange,
}: {
  equipmentId: string;
  start: string;
  end: string;
  onRange: (startDate: string, endDate: string) => void;
}) {
  const today = localDate(new Date());
  const first = start ? localDate(new Date(start)) : '';
  const last = end ? localDate(new Date(end)) : '';
  const [month, setMonth] = useState(() => (first && first > today ? first : today).slice(0, 7));
  // Pickup chosen, return not yet.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const monthStart = `${month}-01`;
  const gridStart = addDays(monthStart, -new Date(`${monthStart}T00:00:00`).getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const gridEnd = cells[41]!;
  const visible = useQuery({
    ...availabilityQuery(equipmentId, gridStart < today ? today : gridStart, gridEnd),
    enabled: Boolean(getAccessToken()),
  });
  const byDate = new Map((visible.data?.days ?? []).map((d) => [d.date, d]));

  const shift = (n: number) => {
    const d = new Date(`${monthStart}T00:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(localDate(d).slice(0, 7));
  };

  const spanStart = anchor ?? first;
  const spanEnd = anchor ? (hover && hover >= anchor ? hover : anchor) : last;

  function pick(date: string) {
    if (anchor && date >= anchor) {
      onRange(anchor, date);
      setAnchor(null);
    } else {
      setAnchor(date);
      onRange(date, date);
    }
  }

  const title = new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const hours = visible.data?.hours;
  const span = first && last ? daysBetween(first, last) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={month <= today.slice(0, 7)}
          aria-label="Previous month"
          className="flex min-h-10 min-w-10 items-center justify-center rounded-sm text-text hover:bg-surface-sunk disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="font-display text-sm font-semibold text-text" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="flex min-h-10 min-w-10 items-center justify-center rounded-sm text-text hover:bg-surface-sunk"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div role="group" aria-label={`Rental dates, ${title}`} className="grid grid-cols-7 gap-y-1" onMouseLeave={() => setHover(null)}>
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden className="pb-1 text-center text-xs font-medium text-text-muted">
            {d}
          </span>
        ))}
        {cells.map((date) => {
          const info = byDate.get(date);
          const taken = info ? !info.available : false;
          const disabled = date < today || taken;
          const inSpan = Boolean(spanStart) && date >= spanStart && date <= spanEnd;
          const edge = date === spanStart || date === spanEnd;
          const reason = taken ? (REASON[info?.reason ?? ''] ?? 'Taken') : '';
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-label={`${prettyDate(date)}${reason ? `, ${reason}` : ''}`}
              aria-pressed={inSpan}
              title={reason || undefined}
              onClick={() => pick(date)}
              onMouseEnter={() => setHover(date)}
              className={[
                'min-h-10 text-sm tabular-nums transition-colors',
                date.slice(0, 7) === month ? '' : 'opacity-40',
                disabled
                  ? `cursor-not-allowed text-text-muted ${taken ? 'line-through' : ''}`
                  : edge
                    ? 'rounded-sm bg-accent font-semibold text-white'
                    : inSpan
                      ? 'bg-accent/15 text-text'
                      : 'rounded-sm text-text hover:bg-surface-sunk',
              ].join(' ')}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span aria-live="polite">
          {anchor
            ? 'Now pick the return date.'
            : span
              ? `${prettyDate(first)} to ${prettyDate(last)} · ${span} ${span === 1 ? 'day' : 'days'}`
              : 'Pick the pickup date.'}
        </span>
        <span>
          <span className="line-through">12</span> unavailable
          {hours ? ` · open ${hours.openTime}–${hours.closeTime}` : ''}
        </span>
      </div>
    </div>
  );
}
