import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { REFUND_REASONS, type InvoiceSummaryResponse, type RefundReason } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { invoicesQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPost } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Modal } from '../components/modal.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { CheckIcon, AlertIcon, ClockIcon } from '../components/icons.js';
import {
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

const COLUMNS: TableColumn<InvoiceSummaryResponse>[] = [
  {
    header: 'Invoice',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">{formatInvoiceType(row.invoiceType)}</span>
        <span className="font-mono text-xs text-text-muted">{shortCode('invoice', row.id)}</span>
      </div>
    ),
  },
  {
    header: 'Status',
    cell: (row) => {
      const meta = STATUS_META[row.status] ?? STATUS_META['draft']!;
      return <StatusPill tone={meta.tone} label={formatStatus(row.status)} icon={meta.icon} />;
    },
  },
  { header: 'Due', cell: (row) => formatDate(row.dueDate) },
  { header: 'Amount', cell: (row) => formatPeso(row.amount), align: 'right' },
];

// Four columns of a seven-field record, with the id cut to a short code:
// "which rental is this invoice against?" and "what is its full id?" were
// unanswerable from this screen, which is awkward for the one table in the
// console that stands for money already charged.
export function InvoiceDetail({ invoice }: { invoice: InvoiceSummaryResponse }) {
  const rows: [string, string][] = [
    ['Invoice id', invoice.id],
    invoice.truckRequestId
      ? ['Truck request id', invoice.truckRequestId]
      : ['Rental id', invoice.rentalId ?? '--'],
    ['Type', formatInvoiceType(invoice.invoiceType)],
    ['Status', formatStatus(invoice.status)],
    ['Amount', formatPeso(invoice.amount)],
    ['Due', formatDate(invoice.dueDate)],
    ['Raised', formatDate(invoice.createdAt)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border py-2 last:border-0"
          >
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="min-w-0 break-all font-mono text-sm tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {invoice.status === 'issued' && <RecordCash invoice={invoice} />}
      {invoice.status === 'paid' && invoice.invoiceType !== 'deposit_deduction' && <RefundPayment invoice={invoice} />}
    </div>
  );
}

// Cash is only ever settled here, by a staff member with the money in hand
// (CR truck-booking-and-kyc-docs). The API names them on the payment row.
function RecordCash({ invoice }: { invoice: InvoiceSummaryResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const record = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoice.id}/cash-payment`, {}),
    onSuccess: () => {
      toast.success('Cash payment recorded');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error('Not recorded', apiErrorText(e)),
  });
  return (
    <>
      <Button variant="approve" onClick={() => setConfirming(true)}>
        Record cash payment
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Record cash payment"
        body={`Confirm you received ${formatPeso(invoice.amount)} in cash for this invoice. It will be marked paid under your name.`}
        confirmLabel="Record payment"
        pending={record.isPending}
        onConfirm={async () => {
          await record.mutateAsync();
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const REASON_LABELS: Record<RefundReason, string> = {
  requested_by_customer: 'Requested by the customer',
  duplicate: 'Duplicate payment',
  fraudulent: 'Fraudulent',
  others: 'Other',
};

// Online payments only: PayMongo returns the money to the customer's
// wallet, bank or card. The refund shows on the ledger once PayMongo
// confirms it (webhook), not when this is clicked. Cash goes back by hand.
function RefundPayment({ invoice }: { invoice: InvoiceSummaryResponse }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(invoice.amount));
  const [reason, setReason] = useState<RefundReason>('requested_by_customer');
  const [confirming, setConfirming] = useState(false);
  const value = Number(amount);
  const invalid = !(value > 0 && value <= invoice.amount);
  const refund = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoice.id}/refund`, { amountPhp: value, reason }),
    onSuccess: () => {
      toast.success('Refund requested', 'PayMongo is processing it. It appears on the invoice once it clears.');
      setConfirming(false);
    },
    onError: (e) =>
      toast.error(
        'Not refunded',
        e instanceof ApiError && e.message === 'payment_not_refundable'
          ? 'This invoice was not paid online. Return cash payments by hand.'
          : apiErrorText(e),
      ),
  });
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Input
        label="Refund amount (PHP)"
        type="number"
        numeric
        min={0.01}
        max={invoice.amount}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={amount !== '' && invalid ? `Between ${formatPeso(0.01)} and ${formatPeso(invoice.amount)}` : undefined}
      />
      <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
        {REFUND_REASONS.map((r) => (
          <option key={r} value={r}>
            {REASON_LABELS[r]}
          </option>
        ))}
      </Select>
      <Button variant="secondary" disabled={invalid} onClick={() => setConfirming(true)}>
        Refund through PayMongo
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Refund payment"
        body={`Refund ${formatPeso(value)} to the customer through PayMongo? This cannot be undone.`}
        confirmLabel="Refund"
        pending={refund.isPending}
        onConfirm={async () => {
          await refund.mutateAsync();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function PaymentsPage() {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<InvoiceSummaryResponse | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        description="Deposits taken and hours billed against them."
      />
      <DataPanel
        title="Invoices"
        options={invoicesQueries.list(PAGE_SIZE, offset)}
        emptyTitle="No invoices yet"
        emptyDescription="Invoices appear once a reconciliation is approved and a deduction is posted."
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <div>
            <Table
              columns={COLUMNS}
              rows={data.items}
              rowKey={(row) => row.id}
              onRowClick={setSelected}
              rowLabel={(row) => `invoice ${shortCode('invoice', row.id)}`}
            />
            <Pagination
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onOffsetChange={setOffset}
              noun="invoices"
            />
          </div>
        )}
      />
      <Modal
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected ? `Invoice ${shortCode('invoice', selected.id)}` : 'Invoice'}
        description="Read-only. Invoices are raised by a reconciliation, never edited here."
        size="sm"
      >
        {selected && <InvoiceDetail invoice={selected} />}
      </Modal>
    </div>
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
