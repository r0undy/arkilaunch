import { useQuery } from '@tanstack/react-query';
import { equipmentQueries } from '../lib/queries.js';
import { apiErrorText } from '../lib/api-client.js';
import { formatDate, formatPeso, formatStatus } from '../lib/format.js';

const heading = 'text-heading-md text-text';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col rounded-sm border border-border p-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-mono text-heading-md tabular-nums text-text">{value}</span>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
}

export function EquipmentReport({ equipmentId }: { equipmentId: string }) {
  const report = useQuery(equipmentQueries.report(equipmentId));
  if (report.isPending) return <p className="text-sm text-text-muted">Loading report...</p>;
  if (report.isError) return <p className="text-sm text-error">{apiErrorText(report.error)}</p>;
  const r = report.data;
  const litres = (value: number | null) => (value === null ? 'set fuel burn in the Price book' : `${value.toLocaleString()} L`);
  const current = r.maintenance.blocks.find((b) => b.current);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Hours logged" value={`${r.totals.hours.toLocaleString()} h`} hint={`meter ${r.runtimeHours.toLocaleString()} h`} />
        <Tile label="Fuel burned" value={r.totals.fuelLitres === null ? '—' : `${r.totals.fuelLitres.toLocaleString()} L`} {...(r.fuelLPerHour !== null ? { hint: `${r.fuelLPerHour} L/h` } : {})} />
        <Tile label="Rentals" value={String(r.totals.rentals)} hint={formatPeso(r.totals.revenuePhp)} />
        <Tile label="Weather" value={String(r.weather.warnings)} hint={r.weather.usedDespiteWarning ? `${r.weather.usedDespiteWarning} used despite warning` : 'warnings'} />
      </div>

      {current && (
        <p className="rounded-sm border border-warning px-3 py-2 text-sm text-text">
          Blocked until {formatDate(current.endsAt)}
          {current.notes ? ` · ${current.notes}` : ''}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className={heading}>Last 6 months</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {r.months.map((m) => {
            const max = Math.max(1, ...r.months.map((x) => x.hours));
            return (
              <li key={m.month} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2">
                <span className="text-text-muted">{monthLabel(m.month)}</span>
                <span className="h-2 rounded-full bg-border" aria-hidden="true">
                  <span className="block h-2 rounded-full bg-accent" style={{ width: `${(m.hours / max) * 100}%` }} />
                </span>
                <span className="font-mono tabular-nums text-text">
                  {m.hours} h{m.fuelLitres !== null ? ` · ${m.fuelLitres} L` : ''}
                </span>
              </li>
            );
          })}
        </ul>
        {r.fuelLPerHour === null && <p className="text-xs text-text-muted">Fuel: {litres(null)}.</p>}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-text">Rentals ({r.totals.rentals})</summary>
        {r.rentals.length === 0 && <p className="mt-2 text-text-muted">Not rented yet.</p>}
        <ul className="mt-2 flex flex-col gap-1">
          {r.rentals.map((rental) => (
            <li key={rental.rentalId} className="flex flex-wrap justify-between gap-2 border-b border-border py-1">
              <span className="text-text">
                {rental.companyName ?? 'Customer'} <span className="text-text-muted">· {formatDate(rental.start)} – {formatDate(rental.end)}</span>
              </span>
              <span className="text-text-muted">
                {formatStatus(rental.status)}
                {rental.revenuePhp !== null ? ` · ${formatPeso(rental.revenuePhp)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-text">
          Maintenance ({r.maintenance.services} services{r.maintenance.lastServiceAt ? `, last ${formatDate(r.maintenance.lastServiceAt)}` : ''})
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {r.maintenance.recent.map((log) => (
            <li key={log.performedAt} className="text-text">
              {formatDate(log.performedAt)} · {log.task ?? 'General service'}
              {log.notes ? <span className="text-text-muted"> · {log.notes}</span> : null}
            </li>
          ))}
          {r.maintenance.blocks.map((b) => (
            <li key={b.startsAt} className="text-text-muted">
              Blocked {formatDate(b.startsAt)} – {formatDate(b.endsAt)}
              {b.notes ? ` · ${b.notes}` : ''}
            </li>
          ))}
          {r.maintenance.recent.length === 0 && r.maintenance.blocks.length === 0 && <li className="text-text-muted">Nothing recorded yet.</li>}
        </ul>
      </details>
    </div>
  );
}
