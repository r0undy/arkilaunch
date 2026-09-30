import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { Button } from './button.js';
import { Modal } from './modal.js';
import { Select } from './select.js';

type DateKind = 'date' | 'datetime-local';

interface DatePickerProps {
  id: string;
  label: string;
  kind: DateKind;
  value: string;
  min?: string | number | undefined;
  max?: string | number | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  hint?: ReactNode | undefined;
  size?: 'default' | 'field' | 'compact';
  labelHidden?: boolean | undefined;
  className?: string;
  onChange: (value: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const addDays = (day: string, count: number) => {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(year!, month! - 1, date! + count);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
};
const shiftMonth = (month: string, count: number) => {
  const [year, number] = month.split('-').map(Number);
  const next = new Date(year!, number! - 1 + count, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
};
const dateLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-PH', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric',
});

export function DatePicker({ id, label, kind, value, min, max, required, disabled, error, hint, size = 'default', labelHidden, className = '', onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [month, setMonth] = useState('');
  const minValue = String(min ?? '');
  const maxValue = String(max ?? '');
  const minDay = minValue.slice(0, 10);
  const maxDay = maxValue.slice(0, 10);
  const chosenDay = draft.slice(0, 10);
  const hour = draft.slice(11, 13) || '09';
  const minute = draft.slice(14, 16) || '00';
  const candidate = kind === 'date' ? chosenDay : `${chosenDay}T${hour}:${minute}`;
  const valid = Boolean(chosenDay) && chosenDay.slice(0, 7) === month && (!minValue || candidate >= minValue) && (!maxValue || candidate <= maxValue);

  function show() {
    const initial = value.slice(0, 10) || (minDay > today() ? minDay : today());
    setDraft(value || (kind === 'date' ? initial : `${initial}T09:00`));
    setMonth(initial.slice(0, 7));
    setOpen(true);
  }

  function pick(day: string) {
    setDraft(kind === 'date' ? day : `${day}T${hour}:${minute}`);
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = offset[event.key] === undefined ? '' : addDays(day, offset[event.key]!);
    if (event.key === 'Home') next = addDays(day, -new Date(`${day}T12:00:00`).getDay());
    if (event.key === 'End') next = addDays(day, 6 - new Date(`${day}T12:00:00`).getDay());
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const targetMonth = shiftMonth(day.slice(0, 7), event.key === 'PageUp' ? -1 : 1);
      const [year, number] = targetMonth.split('-').map(Number);
      next = `${targetMonth}-${pad(Math.min(Number(day.slice(8)), new Date(year!, number!, 0).getDate()))}`;
    }
    if (!next || (minDay && next < minDay) || (maxDay && next > maxDay)) return;
    event.preventDefault();
    pick(next);
    setMonth(next.slice(0, 7));
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-calendar-day="${next}"]`)?.focus());
  }

  const first = `${month}-01`;
  const gridStart = month ? addDays(first, -new Date(`${first}T12:00:00`).getDay()) : '';
  const days = month ? Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)) : [];
  const focusDay = chosenDay.slice(0, 7) === month ? chosenDay : days.find((day) => day.slice(0, 7) === month && (!minDay || day >= minDay) && (!maxDay || day <= maxDay));
  const firstYear = minDay ? Number(minDay.slice(0, 4)) : 1900;
  const lastYear = maxDay ? Number(maxDay.slice(0, 4)) : 2100;
  const shown = value ? `${shortDate(value.slice(0, 10))}${kind === 'datetime-local' ? `, ${value.slice(11, 16)}` : ''}` : labelHidden ? label : 'Choose date';
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={`${id}-label`} className={labelHidden ? 'sr-only' : 'text-sm font-medium text-text'}>{label}{required && <span aria-hidden="true"> *</span>}</span>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}`}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        onClick={show}
        className={`flex w-full min-w-0 items-center justify-between border bg-surface text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-40 ${size === 'compact' ? 'min-h-9 gap-2 px-3 py-1.5 text-sm' : `gap-3 px-4 py-2.5 text-base ${size === 'field' ? 'min-h-12' : 'min-h-11'}`} ${error ? 'border-error' : 'border-border hover:border-border-strong'} ${className}`}
      >
        <span className={`truncate ${value ? 'text-text' : 'text-text-muted'}`}>{shown}</span>
        <CalendarDays className={`${size === 'compact' ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 text-text-muted`} aria-hidden="true" />
      </button>
      {error && <p id={errorId} role="alert" className="flex items-center gap-1 text-sm text-error"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}
      {!error && hint && <p id={hintId} className="text-sm text-text-muted">{hint}</p>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Choose ${label.toLowerCase()}`}
        size="sm"
        footer={<>
          {!required && <Button variant="ghost" className="mr-auto" onClick={() => { onChange(''); setOpen(false); }}>Clear</Button>}
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { onChange(candidate); setOpen(false); }}>Select date</Button>
        </>}
      >
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Previous month" disabled={Boolean(minDay && shiftMonth(month, -1) < minDay.slice(0, 7))} onClick={() => setMonth(shiftMonth(month, -1))} className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-surface-sunk disabled:opacity-40"><ChevronLeft aria-hidden="true" /></button>
          <strong aria-live="polite" className="text-sm font-medium text-text">{new Date(`${month}-01T12:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</strong>
          <button type="button" aria-label="Next month" disabled={Boolean(maxDay && shiftMonth(month, 1) > maxDay.slice(0, 7))} onClick={() => setMonth(shiftMonth(month, 1))} className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-surface-sunk disabled:opacity-40"><ChevronRight aria-hidden="true" /></button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Select label="Month" value={month.slice(5, 7)} onChange={(event) => setMonth(`${month.slice(0, 4)}-${event.target.value}`)}>
            {Array.from({ length: 12 }, (_, n) => <option key={n} value={pad(n + 1)} disabled={Boolean((minDay && `${month.slice(0, 4)}-${pad(n + 1)}` < minDay.slice(0, 7)) || (maxDay && `${month.slice(0, 4)}-${pad(n + 1)}` > maxDay.slice(0, 7)))}>{new Date(2020, n, 1).toLocaleDateString('en-PH', { month: 'long' })}</option>)}
          </Select>
          <Select label="Year" value={month.slice(0, 4)} onChange={(event) => setMonth(`${event.target.value}-${month.slice(5, 7)}`)}>
            {Array.from({ length: lastYear - firstYear + 1 }, (_, n) => <option key={n} value={String(firstYear + n)}>{firstYear + n}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-7 text-center text-xs text-text-muted" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => <span key={name}>{name}</span>)}</div>
        <div role="group" aria-label="Calendar days" className="mt-1 grid grid-cols-7 gap-0.5">
          {days.map((day) => {
            const unavailable = (minDay && day < minDay) || (maxDay && day > maxDay);
            return <button key={day} type="button" data-calendar-day={day} aria-label={dateLabel(day)} aria-pressed={day === chosenDay} disabled={Boolean(unavailable)} tabIndex={day === focusDay ? 0 : -1} onClick={() => pick(day)} onKeyDown={(event) => onDayKeyDown(event, day)} className={`min-h-11 min-w-0 rounded-sm text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-30 ${day === chosenDay ? 'bg-accent text-white' : day.slice(0, 7) === month ? 'text-text hover:bg-surface-sunk' : 'text-text-muted hover:bg-surface-sunk'}`}>{Number(day.slice(8))}</button>;
          })}
        </div>
        {kind === 'datetime-local' && <div className="mt-4 grid grid-cols-2 gap-3">
          <Select label="Hour" value={hour} onChange={(event) => setDraft(`${chosenDay}T${event.target.value}:${minute}`)}>{Array.from({ length: 24 }, (_, n) => <option key={n} value={pad(n)}>{pad(n)}</option>)}</Select>
          <Select label="Minute" value={minute} onChange={(event) => setDraft(`${chosenDay}T${hour}:${event.target.value}`)}>{Array.from({ length: 60 }, (_, n) => <option key={n} value={pad(n)}>{pad(n)}</option>)}</Select>
        </div>}
        {!valid && chosenDay && <p role="status" className="mt-3 text-sm text-error">Choose a date and time within the allowed range.</p>}
      </Modal>
    </div>
  );
}
