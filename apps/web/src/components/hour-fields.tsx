import { classifyHours, lineItemsToDayHours, type EdtrLineItemsInput } from '@arkilaunch/shared';
import { Input } from './input.js';


export interface HourFieldValues {
  total: string;
  running: string;
  idle: string;
  breakdown: string;
  weather: string;
  other: string;
  note: string;
  meterStart: string;
  meterEnd: string;
}

export const EMPTY_HOURS: HourFieldValues = {
  total: '',
  running: '',
  idle: '0',
  breakdown: '0',
  weather: '0',
  other: '0',
  note: '',
  meterStart: '',
  meterEnd: '',
};

const n = (s: string) => (s.trim() === '' ? null : Number(s));

export function hourValuesFrom(item: {
  hoursActive: number;
  hoursIdle: number | null;
  hoursTotal?: number | null | undefined;
  hoursBreakdown?: number | null | undefined;
  hoursWeather?: number | null | undefined;
  hoursOtherDowntime?: number | null | undefined;
  downtimeNote?: string | null | undefined;
  hourMeterStart?: number | null | undefined;
  hourMeterEnd?: number | null | undefined;
}): HourFieldValues {
  const s = (v: number | null | undefined, blank = '') => (v == null ? blank : String(v));
  return {
    total: s(item.hoursTotal),
    running: String(item.hoursActive),
    idle: s(item.hoursIdle, '0'),
    breakdown: s(item.hoursBreakdown, '0'),
    weather: s(item.hoursWeather, '0'),
    other: s(item.hoursOtherDowntime, '0'),
    note: item.downtimeNote ?? '',
    meterStart: s(item.hourMeterStart),
    meterEnd: s(item.hourMeterEnd),
  };
}

// Null when a required figure is missing or not a number.
export function toLineItems(v: HourFieldValues): EdtrLineItemsInput | null {
  const running = n(v.running);
  const idle = n(v.idle) ?? 0;
  const values = [running, idle, n(v.breakdown), n(v.weather), n(v.other), n(v.total), n(v.meterStart), n(v.meterEnd)];
  if (running === null || values.some((x) => x !== null && (!Number.isFinite(x) || x < 0))) return null;
  return {
    hoursActive: running,
    hoursIdle: idle,
    hoursTotal: n(v.total),
    hoursBreakdown: n(v.breakdown) ?? 0,
    hoursWeather: n(v.weather) ?? 0,
    hoursOtherDowntime: n(v.other) ?? 0,
    downtimeNote: v.note.trim() || null,
    hourMeterStart: n(v.meterStart),
    hourMeterEnd: n(v.meterEnd),
  };
}

export function HourFields({
  value,
  onChange,
  idPrefix,
}: {
  value: HourFieldValues;
  onChange: (next: HourFieldValues) => void;
  idPrefix: string;
}) {
  const set = (key: keyof HourFieldValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value });
  const li = toLineItems(value);
  const c = li ? classifyHours(lineItemsToDayHours(li)) : null;
  const parts = c ? c.running + c.idle + c.nonBillable : null;
  const total = n(value.total);
  const totalOff = total !== null && parts !== null && Math.abs(total - parts) > 0.25;

  const hours = (key: keyof HourFieldValues, label: string, hint?: string) => (
    <Input
      id={`${idPrefix}-${key}`}
      label={label}
      numeric
      type="number"
      step="0.5"
      min="0"
      max="24"
      value={value[key]}
      onChange={set(key)}
      {...(hint ? { hint } : {})}
    />
  );

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Hours for the day</legend>
      <p className="text-xs text-text-muted">
        Total = Running + Idle + Breakdown + Weather + Other. Only Running and Idle are billed.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {hours('total', 'Total hours', 'Time on duty from IN/OUT')}
        {hours('running', 'Running hrs', 'Engine working')}
        {hours('idle', 'Idle hrs', 'Ready, client chose not to use')}
        {hours('breakdown', 'Breakdown hrs', 'Not billed')}
        {hours('weather', 'Weather hrs', 'Not billed')}
        {hours('other', 'Other downtime hrs', 'Not billed; add a remark')}
      </div>
      <Input
        id={`${idPrefix}-note`}
        label="Downtime remark"
        value={value.note}
        onChange={set('note')}
        maxLength={500}
        placeholder="e.g. No operator from us after lunch"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          id={`${idPrefix}-meterStart`}
          label="Hour meter start"
          numeric
          type="number"
          step="0.1"
          min="0"
          value={value.meterStart}
          onChange={set('meterStart')}
        />
        <Input
          id={`${idPrefix}-meterEnd`}
          label="Hour meter end"
          numeric
          type="number"
          step="0.1"
          min="0"
          value={value.meterEnd}
          onChange={set('meterEnd')}
        />
      </div>
      {c && (
        <p className="text-sm text-text" aria-live="polite">
          Billable <span className="font-mono font-semibold">{c.billable.toFixed(1)} h</span> · Running{' '}
          <span className="font-mono">{c.running.toFixed(1)} h</span> · Not billed{' '}
          <span className="font-mono">{c.nonBillable.toFixed(1)} h</span>
          {c.meterDelta !== null && (
            <>
              {' '}
              · Meter <span className="font-mono">{c.meterDelta.toFixed(1)} h</span>
            </>
          )}
        </p>
      )}
      {totalOff && (
        <p className="text-sm text-warning">
          The parts add up to {parts!.toFixed(1)} h, not the total of {total!.toFixed(1)} h. Check the sheet.
        </p>
      )}
    </fieldset>
  );
}
