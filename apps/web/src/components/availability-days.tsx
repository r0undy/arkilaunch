import { useState } from 'react';
import { equipmentQueries } from '../lib/queries.js';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { bookingDays, minRentalDays, type AvailabilityResponse } from '@arkilaunch/shared';
import { getAccessToken } from '../lib/auth-client.js';
import { WEEKDAYS } from '../lib/format.js';

const DAYS_AHEAD = 60;
const REASON: Record<string, string> = {
  assignment: 'Booked',
  hold: 'On hold',
  maintenance: 'Maintenance',
  closed: 'Office closed',
  holiday: 'Office closed (holiday)',
  operator: 'No operator',
};

// Office-closed days stop only pickup and return; a rental may run through them.
const OFFICE_CLOSED = new Set(['closed', 'holiday']);
const isTaken = (reason: string | null | undefined) => Boolean(reason) && !OFFICE_CLOSED.has(reason!);

// ponytail: assumes the browser is on Manila time; pass a timezone to the API if bookings cross zones.
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function useAvailability(equipmentId: string, end?: string) {
  const from = localDate(new Date());
  const minTo = localDate(new Date(Date.now() + (DAYS_AHEAD - 1) * 86_400_000));
  const endDate = end ? localDate(new Date(end)) : '';
  return useQuery({
    ...equipmentQueries.availability(equipmentId, from, endDate > minTo ? endDate : minTo),
    enabled: Boolean(getAccessToken()),
  });
}

export function availabilityProblem(data: AvailabilityResponse | undefined, startIso: string, endIso: string): string | null {
  if (!data || !startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const first = localDate(start);
  const last = localDate(end);
  const edge = data.days.find((d) => !d.available && (d.date === first || d.date === last));
  if (edge) {
    const what = edge.date === first ? 'Pickup' : 'Return';
    return `${what} on ${edge.date} is not possible (${(REASON[edge.reason ?? ''] ?? 'taken').toLowerCase()}).`;
  }
  const taken = data.days.find((d) => !d.available && isTaken(d.reason) && d.date > first && d.date < last);
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

export function rentalLengthProblem(data: AvailabilityResponse | undefined, startIso: string, endIso: string): string | null {
  if (!data || !startIso || !endIso) return null;
  const minDays = minRentalDays(data.dailyHours, data.minHours);
  if (bookingDays(startIso, endIso) >= minDays) return null;
  return `This company rents for at least ${minDays} days (its ${data.minHours}-hour minimum at ${data.dailyHours} hours a day). Pick a later return date.`;
}

const heldLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1;
const prettyDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

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
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const monthStart = `${month}-01`;
  const gridStart = addDays(monthStart, -new Date(`${monthStart}T00:00:00`).getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const gridEnd = cells[41]!;
  const visible = useQuery({
    ...equipmentQueries.availability(equipmentId, gridStart < today ? today : gridStart, gridEnd),
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

  const spansTaken = (from: string, to: string) =>
    cells.some((d) => d > from && d < to && isTaken(byDate.get(d)?.reason ?? null));

  function pick(date: string) {
    if (anchor && date >= anchor && !spansTaken(anchor, date)) {
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
  const nextFree = (visible.data?.days ?? []).find((d) => d.available && d.date >= today)?.date;
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
        <p className="text-sm font-semibold text-text" aria-live="polite">
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
          const unavailable = info ? !info.available : false;
          const taken = unavailable && isTaken(info?.reason);
          const closed = unavailable && !taken;
          const disabled = date < today || unavailable;
          const inSpan = Boolean(spanStart) && date >= spanStart && date <= spanEnd;
          const edge = date === spanStart || date === spanEnd;
          const held = info?.reason === 'hold';
          const reason = unavailable
            ? held && info?.heldUntil
              ? `On hold for another customer until ${heldLabel(info.heldUntil)}; frees up if unpaid`
              : (REASON[info?.reason ?? ''] ?? 'Taken')
            : '';
          return (
            <button
              key={date}
              type="button"
              data-date={date}
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
                  ? [
                      'cursor-not-allowed',
                      held
                        ? 'rounded-sm border border-dashed border-text-muted/50 bg-surface-sunk text-text-muted'
                        : taken
                        ? `rounded-sm text-text-muted line-through ${info?.reason === 'maintenance' ? 'bg-warning/15' : 'bg-error/10'}`
                        : closed
                          ? inSpan
                            ? 'bg-accent/10 text-text-muted'
                            : 'text-text-muted/60'
                          : 'text-text-muted/50',
                    ].join(' ')
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
        {nextFree && !first && <span className="font-medium text-text">Next available: {prettyDate(nextFree)}</span>}
      </div>
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm bg-error/10" />
          <span className="line-through">Booked</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm border border-dashed border-text-muted/50 bg-surface-sunk" />
          On hold (unpaid request; frees up if not paid in time)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm bg-warning/15" />
          <span className="line-through">Maintenance</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm border border-border" />
          Office closed{hours ? ` · open ${hours.openTime}–${hours.closeTime}` : ''} (can rent through, not pick up or return)
        </li>
      </ul>
    </div>
  );
}
