import type { RentPart } from '@arkilaunch/shared';
import type { QuoteDetail, QuoteLine } from '../lib/queries.js';
import { formatPeso } from '../lib/format.js';

const UNIT: Record<string, [string, string, string]> = {
  hourly: ['hr', 'hour', 'hours'],
  daily: ['day', 'day', 'days'],
  monthly: ['mo', 'month', 'months'],
};

function count(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// "₱8,000.00/day × 12 days"; parts join with "+" (1 month + 15 days).
export function rentText(parts: RentPart[]): string {
  return parts
    .map((part) => {
      const [short, one, many] = UNIT[part.rateType] ?? ['unit', 'unit', 'units'];
      return `${formatPeso(part.ratePhp)}/${short} × ${count(part.count)} ${part.count === 1 ? one : many}`;
    })
    .join(' + ');
}

function lineName(line: QuoteLine, typeName?: (id: string) => string): string {
  if (line.kind === 'custom') return line.description ?? 'Item';
  return line.equipmentTypeName ?? (line.equipmentTypeId && typeName ? typeName(line.equipmentTypeId) : 'Equipment');
}

function lineDetail(line: QuoteLine): string {
  if (line.kind === 'custom') return `${formatPeso(line.subtotal / line.quantity)} each`;
  // Quotes from before per-unit pricing carry no rent breakdown.
  if (line.rentParts.length === 0) return `${line.estimatedHours} h at ${formatPeso(line.hourlyRate)}/h`;
  const extras = line.operatingCost - line.rent + line.buffer;
  return `${rentText(line.rentParts)}${extras > 0.005 ? `, plus ${formatPeso(extras)} operator, fuel and upkeep` : ''}`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? 'text-text' : 'text-text-muted'}>{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

// The quote as both sides read it: each line with how it was charged, then
// mobilization, demobilization, discount and total. Shared by the admin
// quote builder, the customer's negotiation page and the printable quote.
export function QuoteLines({ quote, typeName }: { quote: QuoteDetail; typeName?: (id: string) => string }) {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Quote line items" className="flex flex-col gap-2 border-b border-border pb-3">
        {quote.lineItems.map((line, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-text">
              {line.quantity} &times; {lineName(line, typeName)}
              <span className="block text-xs text-text-muted">{lineDetail(line)}</span>
            </span>
            <span className="font-mono text-text">{formatPeso(line.subtotal)}</span>
          </li>
        ))}
      </ul>
      {quote.mobilization > 0 && <Row label="Mobilization" value={formatPeso(quote.mobilization)} />}
      {quote.demobilization > 0 && <Row label="Demobilization" value={formatPeso(quote.demobilization)} />}
      <Row label="Subtotal" value={formatPeso(quote.subtotal)} />
      {quote.discount > 0 && <Row label="Discount" value={`- ${formatPeso(quote.discount)}`} />}
      <Row label="Total" value={formatPeso(quote.total)} strong />
    </div>
  );
}
