import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
import { Tabs } from '../components/tabs.js';
import { Receipt } from 'lucide-react';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { StatusBadge } from '../components/status-badge.js';
import { CopyButton } from '../components/copy-button.js';
import {
  formatDate,
  formatInvoiceType,
  formatPeso,
  shortCode,
} from '../lib/format.js';

const COLUMNS: TableColumn<InvoiceSummaryResponse>[] = [
  {
    header: 'Invoice', kind: 'text',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-text">{formatInvoiceType(row.invoiceType)}</span>
        <span className="font-mono text-xs text-text-muted">{shortCode('invoice', row.id)}</span>
      </div>
    ),
  },
  {
    header: 'Status', kind: 'status',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  { header: 'Due', kind: 'date', cell: (row) => formatDate(row.dueDate) },
  { header: 'Amount', kind: 'money', cell: (row) => formatPeso(row.amount) },
];

// Four columns of a seven-field record, with the id cut to a short code:
// "which rental is this invoice against?" and "what is its full id?" were
// unanswerable from this screen, which is awkward for the one table in the
// console that stands for money already charged.
export function InvoiceDetail({ invoice, onDone }: { invoice: InvoiceSummaryResponse; onDone: () => void }) {
  const rows: [string, ReactNode][] = [
    [
      'Reference',
      <span key="ref" className="inline-flex items-center gap-1">
        {shortCode('invoice', invoice.id)}
        <CopyButton value={invoice.id} label="the full invoice id" />
      </span>,
    ],
    [invoice.truckRequestId ? 'Truck service' : 'Equipment rental', invoice.bookingCode ?? '--'],
    ['Type', formatInvoiceType(invoice.invoiceType)],
    ['Status', <StatusBadge key="status" status={invoice.status} />],
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
            <dd className="min-w-0 break-words font-mono text-sm tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {/* One row of actions; each opens its own dialog rather than stacking
          two money forms inside this one. */}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3 empty:hidden">
        {invoice.status === 'issued' && <RecordCash invoice={invoice} onDone={onDone} />}
        {invoice.status === 'issued' && ADJUSTABLE.has(invoice.invoiceType) && <ChangeAmount invoice={invoice} onDone={onDone} />}
        {invoice.status === 'paid' && invoice.invoiceType !== 'deposit_deduction' && <RefundPayment invoice={invoice} />}
      </div>
    </div>
  );
}

// Invoices the customer checks out (the server's ADJUSTABLE_INVOICE_TYPES).
const ADJUSTABLE = new Set(['booking', 'deposit', 'truck']);

// Lower what an unpaid invoice charges (never raise it). The customer's next
// checkout charges the new amount; any open PayMongo page at the old amount
// is closed. PHP 1.00 is PayMongo's smallest charge. Audit-logged with the reason.
function ChangeAmount({ invoice, onDone }: { invoice: InvoiceSummaryResponse; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(invoice.amount));
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const value = Number(amount);
  const invalid = !(value >= 1 && value <= invoice.amount) || reason.trim().length < 3;
  const change = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoice.id}/amount`, { amountPhp: value, reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Amount changed', `The customer's next checkout charges ${formatPeso(value)}.`);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onDone();
    },
    onError: (e) =>
      toast.error(
        'Not changed',
        e instanceof ApiError && e.message === 'payment_in_progress'
          ? 'A payment for this invoice is going through right now. Try again in a minute.'
          : apiErrorText(e),
      ),
  });
  const close = () => {
    setOpen(false);
    setAmount(String(invoice.amount));
    setReason('');
  };
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Change amount
      </Button>
      {/* The dialog is the confirm: it states the change in full and takes a
          deliberate click, never a stray one on the backdrop. */}
      <Modal
        open={open}
        onClose={change.isPending ? () => undefined : close}
        title="Change invoice amount"
        description="Lower what this unpaid invoice charges; it can never go up. The customer's next checkout charges the new amount."
        size="sm"
        dismissOnScrim={false}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={change.isPending}>
              Cancel
            </Button>
            <Button disabled={invalid} loading={change.isPending} onClick={() => change.mutate()}>
              Change amount
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="New amount (PHP)"
            type="number"
            numeric
            min={1}
            max={invoice.amount}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amount !== '' && !(value >= 1 && value <= invoice.amount) ? `Between ${formatPeso(1)} and ${formatPeso(invoice.amount)}` : undefined}
          />
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="Saved in the audit log." />
          {!invalid && (
            <p className="text-sm text-text">
              From <span className="font-mono tabular-nums">{formatPeso(invoice.amount)}</span> to{' '}
              <span className="font-mono font-semibold tabular-nums">{formatPeso(value)}</span>. The rent comes down first, then the deposit.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

// Cash is only ever settled here, by a staff member with the money in hand
// (CR truck-booking-and-kyc-docs). The API names them on the payment row.
function RecordCash({ invoice, onDone }: { invoice: InvoiceSummaryResponse; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const record = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoice.id}/cash-payment`, {}),
    onSuccess: () => {
      toast.success('Cash payment recorded');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onDone();
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
        onConfirm={() => record.mutate()}
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
  const [open, setOpen] = useState(false);
  const value = Number(amount);
  const invalid = !(value > 0 && value <= invoice.amount);
  const refund = useMutation({
    mutationFn: () => apiPost(`/invoices/${invoice.id}/refund`, { amountPhp: value, reason }),
    onSuccess: () => {
      toast.success('Refund requested', 'PayMongo is processing it. It appears on the invoice once it clears.');
      setOpen(false);
    },
    onError: (e) =>
      toast.error(
        'Not refunded',
        e instanceof ApiError && e.message === 'payment_not_refundable'
          ? 'This invoice was not paid online. Return cash payments by hand.'
          : apiErrorText(e),
      ),
  });
  const close = () => {
    setOpen(false);
    setAmount(String(invoice.amount));
  };
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Refund through PayMongo
      </Button>
      <Modal
        open={open}
        onClose={refund.isPending ? () => undefined : close}
        title="Refund payment"
        description="PayMongo returns the money to the customer's wallet, bank or card. It shows on the invoice once PayMongo confirms it."
        size="sm"
        dismissOnScrim={false}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={refund.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={invalid} loading={refund.isPending} onClick={() => refund.mutate()}>
              Refund
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
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
          {!invalid && (
            <p className="text-sm text-text">
              Refund <span className="font-mono font-semibold tabular-nums">{formatPeso(value)}</span> to the customer. This cannot be undone.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

type InvoiceFilter = 'all' | 'issued' | 'paid';
const INVOICE_FILTERS: Array<{ id: InvoiceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'issued', label: 'Unpaid' },
  { id: 'paid', label: 'Paid' },
];

function PaymentsPage() {
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [selected, setSelected] = useState<InvoiceSummaryResponse | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Deposits taken and hours billed against them."
      />
      <Tabs
        label="Invoice status"
        items={INVOICE_FILTERS}
        value={filter}
        onChange={(next) => {
          setFilter(next);
          setOffset(0);
        }}
      />
      <DataPanel
        title="Invoices"
        options={invoicesQueries.list(PAGE_SIZE, offset, filter === 'all' ? undefined : filter)}
        emptyTitle={filter === 'all' ? 'No invoices yet' : `No ${filter === 'issued' ? 'unpaid' : 'paid'} invoices`}
        emptyDescription="Invoices appear once a booking is confirmed or a reconciliation is approved and a deduction is posted."
        emptyIcon={Receipt}
        isEmpty={(data) => data.total === 0}
        render={(data) => (
          <Table
            columns={COLUMNS}
            rows={data.items}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            rowLabel={(row) => `invoice ${shortCode('invoice', row.id)}`}
            header={{ title: 'Invoices', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="invoices" /> }}
          />
        )}
      />
      <Modal
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected ? `Invoice ${shortCode('invoice', selected.id)}` : 'Invoice'}
        description="Raised by a reconciliation. Money moves only through the actions below."
        size="sm"
      >
        {selected && <InvoiceDetail invoice={selected} onDone={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}

export const appPaymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/payments',
  component: PaymentsPage,
});
