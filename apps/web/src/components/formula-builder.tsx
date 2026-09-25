import { useState } from 'react';
import { DEFAULT_TRUCK_FORMULA, FormulaError, formulaVarName, priceTruckTrip, type TruckSettings } from '@arkilaunch/shared';
import { formatPeso } from '../lib/format.js';
import { Button } from './button.js';
import { Input } from './input.js';

const LABELS: Record<string, string> = {
  km: 'Distance (km)',
  base: 'Base fee',
  per_km: 'Rate per km',
  diesel: 'Diesel ₱/L',
  fuel_l_per_km: 'Fuel L/km',
  driver_fee: "Driver's fee",
  tolls: 'Tolls',
  extras: 'All extra charges',
};
const OPERATORS: [string, string][] = [
  ['+', '+'],
  ['-', '−'],
  ['*', '×'],
  ['/', '÷'],
  ['(', '('],
  [')', ')'],
];
const TOKEN = /\s*(\d+(?:\.\d+)?|[a-z_][a-z0-9_]*|[-+*/()])/gy;

function tokens(formula: string): string[] {
  TOKEN.lastIndex = 0;
  return [...formula.matchAll(TOKEN)].map((m) => m[1]!);
}

export interface SampleInputs {
  perKmPhp: number;
  fuelLPerKm: number;
  dieselPhp: number;
}

/**
 * The truck price formula, built by clicking: variables as named chips,
 * operators, numbers. The text stays the source of truth (and editable for
 * anyone who prefers typing); every change is checked by the same evaluator
 * the server uses and priced on a sample trip.
 */
export function FormulaBuilder({
  value,
  onChange,
  settings,
  sample,
}: {
  value: string;
  onChange: (next: string) => void;
  settings: Pick<TruckSettings, 'baseFeePhp' | 'driverFeePhp' | 'extras'>;
  sample: SampleInputs;
}) {
  const [number, setNumber] = useState('');
  const [raw, setRaw] = useState(false);
  const extraVars = settings.extras.map((x) => [formulaVarName(x.label), x.label] as const).filter(([name]) => name && !(name in LABELS));
  const label = (token: string) => LABELS[token] ?? extraVars.find(([name]) => name === token)?.[1] ?? token;
  const list = tokens(value);
  const append = (token: string) => onChange(`${value.trim()} ${token}`.trim());
  const undo = () => onChange(list.slice(0, -1).join(' '));

  // Priced on a sample 100 km trip with two ₱500 tolls, by the same code
  // that prices a real request.
  let preview: { total: number; sum: number } | null = null;
  let error: string | null = null;
  try {
    const trip = { km: 100, perKmPhp: sample.perKmPhp, fuelLPerKm: sample.fuelLPerKm, dieselPhp: sample.dieselPhp, tolls: [{ label: 'A', amountPhp: 500 }, { label: 'B', amountPhp: 500 }] };
    const custom = priceTruckTrip({ ...trip, settings: { ...settings, formula: value.trim() || DEFAULT_TRUCK_FORMULA } });
    const standard = priceTruckTrip({ ...trip, settings: { ...settings, formula: null } });
    preview = { total: custom.totalPhp, sum: standard.totalPhp };
  } catch (e) {
    error = e instanceof FormulaError ? `The formula has a mistake: ${e.message}.` : 'The formula has a mistake.';
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Price formula builder">
      <span className="text-sm font-medium text-text">Price formula</span>
      <div
        className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2"
        aria-live="polite"
        aria-label="Formula so far"
      >
        {list.length === 0 && <span className="text-sm text-text-muted">Click the pieces below to build the price.</span>}
        {list.map((token, i) =>
          /^[a-z_]/.test(token) ? (
            <span key={i} className="rounded-sm bg-accent/15 px-2 py-0.5 text-sm font-medium text-text">
              {label(token)}
            </span>
          ) : (
            <span key={i} className="font-mono text-sm text-text">
              {OPERATORS.find(([op]) => op === token)?.[1] ?? token}
            </span>
          ),
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-muted">Values</span>
        <div className="flex flex-wrap gap-1.5">
          {[...Object.keys(LABELS), ...extraVars.map(([name]) => name)].map((name) => (
            <Button key={name} type="button" variant="secondary" onClick={() => append(name)}>
              {label(name)}
            </Button>
          ))}
        </div>
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-muted">Operators</span>
        <div className="flex flex-wrap items-end gap-1.5">
          {OPERATORS.map(([op, shown]) => (
            <Button key={op} type="button" variant="secondary" aria-label={`Insert ${shown}`} onClick={() => append(op)}>
              {shown}
            </Button>
          ))}
          <div className="w-28">
            <Input label="Number" type="number" min="0" step="any" numeric value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" disabled={number === '' || Number(number) < 0} onClick={() => { append(String(Number(number))); setNumber(''); }}>
            Add number
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="ghost" disabled={list.length === 0} onClick={undo}>
            Undo last
          </Button>
          <Button type="button" variant="ghost" disabled={list.length === 0} onClick={() => onChange('')}>
            Clear
          </Button>
          <Button type="button" variant="ghost" onClick={() => onChange(DEFAULT_TRUCK_FORMULA)}>
            Reset to standard
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRaw((r) => !r)}>
            {raw ? 'Hide text' : 'Edit as text'}
          </Button>
        </div>
        {raw && <Input label="Formula text" value={value} onChange={(e) => onChange(e.target.value)} />}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : (
        preview && (
          <p className="text-sm text-text">
            Sample 100 km trip with ₱1,000 in tolls: <span className="font-mono font-semibold">{formatPeso(preview.total)}</span>
            {preview.total !== preview.sum && (
              <span className="text-text-muted"> (the standard formula gives {formatPeso(preview.sum)})</span>
            )}
          </p>
        )
      )}
    </div>
  );
}
