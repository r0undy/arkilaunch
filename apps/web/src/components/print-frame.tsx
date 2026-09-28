import type { ReactNode } from 'react';
import { useTenant } from '../lib/tenant.js';
import { formatDate } from '../lib/format.js';

// Every printed document's letterhead and running footer (QA 20): the
// rental company's logo, name, address, contacts and TIN in its own brand
// colour, then the document's title, reference, dates and key facts. Shown
// only on paper; the screen keeps its own layout. A div, not a <header>:
// print CSS hides <header> (the app bar). Page X of Y comes from the @page
// margin box in index.css.

const printedAt = () =>
  new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

export function PrintFrame({
  title,
  docRef,
  issuedAt,
  details = [],
}: {
  title: string;
  docRef: string;
  issuedAt?: string | Date | null | undefined;
  // Document-specific facts: bill-to, period, due date, status...
  details?: [label: string, value: ReactNode][];
}) {
  const tenant = useTenant();
  const accent = tenant?.primaryColor ?? '#111111';
  const address = [tenant?.address, tenant?.city, tenant?.province].filter(Boolean).join(', ');
  const contacts = [tenant?.phone, tenant?.contactEmail].filter(Boolean).join(' · ');
  const name = tenant?.name ?? 'ArkiLaunch';
  return (
    <>
      <div className="hidden print:block" style={{ borderBottom: `3px solid ${accent}` }} data-print-letterhead>
        <div className="flex items-start justify-between gap-6 pb-3">
          <div className="flex items-start gap-3">
            {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-14 w-auto max-w-40 object-contain" />}
            <div className="text-xs leading-snug text-black">
              <p className="text-base font-bold" style={{ color: accent }}>
                {name}
              </p>
              {address && <p>{address}</p>}
              {contacts && <p>{contacts}</p>}
              {tenant?.tin && <p>TIN {tenant.tin}</p>}
            </div>
          </div>
          <div className="text-right text-xs leading-snug text-black">
            <p className="text-base font-bold uppercase tracking-wide">{title}</p>
            <p className="font-mono">{docRef}</p>
            {issuedAt && <p>Issued {formatDate(issuedAt)}</p>}
            <p>Printed {printedAt()}</p>
          </div>
        </div>
        {details.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 pb-3 text-xs text-black">
            {details.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="text-neutral-600">{label}:</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div
        className="hidden print:flex fixed inset-x-0 bottom-0 justify-between gap-4 border-t border-neutral-300 bg-white px-1 pt-1 text-[9px] text-neutral-600"
        data-print-footer
      >
        <span>
          {name}
          {tenant?.tin ? ` · TIN ${tenant.tin}` : ''}
        </span>
        <span className="font-mono">
          {title} {docRef}
        </span>
        <span>Printed {printedAt()} (Asia/Manila)</span>
      </div>
    </>
  );
}
