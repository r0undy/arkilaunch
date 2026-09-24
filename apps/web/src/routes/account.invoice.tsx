import { createRoute, Link } from '@tanstack/react-router';
import { useState, type ReactElement } from 'react';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { useToast } from '../components/toast.js';
import type { InvoiceDetailResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { invoicesQueries } from '../lib/queries.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, ClockIcon } from '../components/icons.js';
import {
  condenseIds,
  formatDate,
  formatInvoiceType,
  formatPeso,
  formatStatus,
  shortCode,
} from '../lib/format.js';

const STATUS_META: Record<string, { tone: StatusTone; icon: ReactElement }> = {
  paid: { tone: 'recon-approved', icon: <CheckIcon /> },
  issued: { tone: 'recon-review', icon: <AlertIcon /> },
  draft: { tone: 'recon-failed', icon: <ClockIcon /> },
  void: { tone: 'recon-failed', icon: <ClockIcon /> },
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

// The Figma frame (168:2304) pairs a left summary card with a right address
// card, then an itemized table whose header band and totals band share one
// accent fill. That accent is the prototype's teal; Yardboard's structural
// equivalent is --color-success, already used for a table header band on the
// dashboard, so the layout carries over without importing the palette.
// A weekly invoice (hours past the deposit) is paid the same two ways as a
// booking: PayMongo, or cash at the office which staff then record.
function PayWeekly({ invoiceId }: { invoiceId: string }) {
  const toast = useToast();
  const [pending, setPending] = useState<'online' | 'cash' | null>(null);
  async function pay(cash: boolean) {
    setPending(cash ? 'cash' : 'online');
    try {
      const res = await apiPost<{ checkoutUrl: string | null }>(`/me/invoices/${invoiceId}/checkout`, cash ? { cash: true } : {});
      if (res.checkoutUrl) window.location.assign(res.checkoutUrl);
      else toast.success('Pay at the office', 'Staff will mark this invoice paid when they receive the cash.');
    } catch (err) {
      toast.error('Could not start the payment', apiErrorText(err));
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="flex flex-wrap gap-2" data-print-hide>
      <Button variant="primary" loading={pending === 'online'} disabled={pending !== null} onClick={() => void pay(false)}>
        Pay now
      </Button>
      <Button variant="secondary" loading={pending === 'cash'} disabled={pending !== null} onClick={() => void pay(true)}>
        Pay in cash
      </Button>
    </div>
  );
}

function InvoiceDetail({ invoice }: { invoice: InvoiceDetailResponse }) {
  const meta = STATUS_META[invoice.status] ?? STATUS_META['draft']!;
  const subtotal = invoice.lineItems.reduce((sum, line) => sum + line.amount, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex flex-col items-start gap-3">
            <StatusPill tone={meta.tone} label={formatStatus(invoice.status)} icon={meta.icon} />
            <div>
              <p className="font-mono text-2xl font-semibold text-text">{formatPeso(invoice.amount)}</p>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                Total amount due
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <SummaryRow label="Invoice type" value={formatInvoiceType(invoice.invoiceType)} />
            <SummaryRow label="Reference" value={shortCode('invoice', invoice.id)} />
            {invoice.truckRequestId ? (
              <SummaryRow label="Truck request" value={shortCode('booking', invoice.truckRequestId)} />
            ) : (
              <SummaryRow label="Rental" value={invoice.rentalId ? shortCode('rental', invoice.rentalId) : '--'} />
            )}
            <SummaryRow label="Due" value={formatDate(invoice.dueDate)} />
          </div>
          {invoice.invoiceType === 'weekly' && invoice.status === 'issued' && <PayWeekly invoiceId={invoice.id} />}
        </Surface>

        {/* The prototype's billing/shipping address pair has no counterpart in
            the API -- an invoice carries a rental, not an address. The slot
            shows the deduction's evidence trail instead, which is what RFC-2
            requires a customer be able to see behind a charge. */}
        <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-4 p-5">
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Evidence for this charge
          </h2>
          {invoice.edtrEvidence ? (
            <div className="flex flex-col gap-3">
              <SummaryRow label="Reconciliation" value={formatStatus(invoice.edtrEvidence.status)} />
              <SummaryRow
                label="Delta hours"
                value={
                  invoice.edtrEvidence.deltaHours === null
                    ? '--'
                    : invoice.edtrEvidence.deltaHours.toFixed(2)
                }
              />
              <SummaryRow label="Tolerance" value={invoice.edtrEvidence.tolerance.toFixed(2)} />
              <SummaryRow
                label="Source logs"
                value={String(invoice.edtrEvidence.sourceEdtrIds.length)}
              />
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              This invoice is not a deposit deduction, so it carries no reconciliation evidence.
            </p>
          )}
        </Surface>
      </div>

      <Surface radius="md" elevation="sm" className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-success px-4 py-3 text-white">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.04em]">
            Itemized costs
          </h2>
          <p className="text-sm">Issued {formatDate(invoice.createdAt)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Description
                </th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Qty
                </th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Unit price
                </th>
                <th className="px-4 py-3 text-right font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((line) => (
                <tr key={line.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 text-text">{condenseIds(line.description)}</td>
                  <td className="px-4 py-3 text-right font-mono text-text">{line.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono text-text">
                    {formatPeso(line.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text">
                    {formatPeso(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col items-end gap-2 border-t border-border bg-surface-sunk px-4 py-4">
          <div className="flex w-full max-w-xs items-center justify-between text-sm">
            <span className="text-text-muted">Subtotal</span>
            <span className="font-mono text-text">{formatPeso(subtotal)}</span>
          </div>
          <div className="flex w-full max-w-xs items-center justify-between border-t border-border pt-2">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.04em] text-text">
              Total
            </span>
            <span className="font-mono text-lg font-semibold text-text">
              {formatPeso(invoice.amount)}
            </span>
          </div>
        </div>
      </Surface>
    </div>
  );
}

function AccountInvoicePage() {
  const { invoiceId } = accountInvoiceRoute.useParams();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title={`Invoice ${shortCode('invoice', invoiceId)}`}
        description="What was charged, and the evidence behind it."
        actions={
          <>
            <Link to="/account/bookings" data-print-hide>
              <Button variant="ghost">Back</Button>
            </Link>
            {/* The frame's "Download PDF" / "Print Statement" pair: print is
                the browser's and needs no endpoint. A generated PDF does, so
                it is left out rather than offered and broken. */}
            <Button variant="secondary" data-print-hide onClick={() => window.print()}>
              Print statement
            </Button>
          </>
        }
      />
      <DataPanel
        title="Invoice"
        options={invoicesQueries.detail(invoiceId)}
        emptyTitle="Invoice not found"
        emptyDescription="This invoice does not exist, or it belongs to another account."
        isEmpty={(data) => !data?.id}
        render={(data) => <InvoiceDetail invoice={data} />}
      />
    </div>
  );
}

export const accountInvoiceRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/invoices/$invoiceId',
  component: AccountInvoicePage,
});
