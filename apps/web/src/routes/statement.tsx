import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatementEmailResponse, StatementOfAccount, StatementPdfResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { appLayoutRoute } from './_app.js';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatDate, formatHours, formatInvoiceType, formatPeso, formatStatus, shortCode } from '../lib/format.js';
import { Surface } from '../components/surface.js';
import { Button, buttonClass } from '../components/button.js';
import { PageHeader } from '../components/page-header.js';
import { PrintFrame } from '../components/print-frame.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { useToast } from '../components/toast.js';

type Scope = 'me' | 'staff';
const statementQuery = (scope: Scope, rentalId: string) => ({
  queryKey: ['statement', scope, rentalId] as const,
  queryFn: () => apiGet<StatementOfAccount>(`${scope === 'me' ? '/me' : ''}/rentals/${rentalId}/statement`),
});
// The server renders the PDF, so the download and the office email are the same file.
function DownloadSoaButton({ scope, rentalId, variant = 'secondary' }: { scope: Scope; rentalId: string; variant?: 'primary' | 'secondary' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await apiGet<StatementPdfResponse>(`${scope === 'me' ? '/me' : ''}/rentals/${rentalId}/statement/pdf`);
      const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not download the statement', apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant={variant} loading={busy} onClick={() => void download()}>
      Download SOA (PDF)
    </Button>
  );
}

function EmailSoaButton({ rentalId, statement }: { rentalId: string; statement: StatementOfAccount }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const send = useMutation({
    mutationFn: () => apiPost<StatementEmailResponse>(`/rentals/${rentalId}/statement/email`, {}),
    onSuccess: (res) => {
      setConfirming(false);
      toast.success('Statement emailed', `Sent to ${res.sentTo}.`);
      void queryClient.invalidateQueries({ queryKey: ['statement', 'staff', rentalId] });
    },
    onError: (e) => toast.error('Could not email the statement', apiErrorText(e)),
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Email SOA
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Email the Statement of Account?"
        body={
          <>
            The PDF goes to the customer&apos;s account email, with a balance due of {formatPeso(statement.totals.balanceDue)}.
            {statement.lastEmailed && ` Last emailed ${formatDate(statement.lastEmailed.at)}${statement.lastEmailed.by ? ` by ${statement.lastEmailed.by}` : ''}.`}
          </>
        }
        confirmLabel="Send email"
        pending={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const range = (from: string, to: string) => `${formatDate(from)} – ${formatDate(to)}`;

function WeeksTable({ statement }: { statement: StatementOfAccount }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            <th className="py-2 pr-3 font-medium">Week</th>
            <th className="py-2 pr-3 text-right font-medium">Hours</th>
            <th className="py-2 pr-3 text-right font-medium">From deposit</th>
            <th className="py-2 pr-3 text-right font-medium">Invoiced</th>
            <th className="py-2 pr-3 text-right font-medium">Not yet invoiced</th>
            <th className="py-2 text-right font-medium">Week total</th>
          </tr>
        </thead>
        <tbody>
          {statement.weeks.map((w) => (
            <tr key={w.weekStart} className="border-b border-border last:border-b-0">
              <td className="py-2 pr-3 text-text">{range(w.weekStart, w.weekEnd)}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatHours(w.hours)}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatPeso(w.fromDeposit)}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatPeso(w.invoiced)}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatPeso(w.unbilled)}</td>
              <td className="py-2 text-right font-mono font-semibold tabular-nums">{formatPeso(w.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeeklyBillingCard({ rentalId, scope }: { rentalId: string; scope: Scope }) {
  const statement = useQuery(statementQuery(scope, rentalId));
  if (!statement.data) return null;
  const s = statement.data;
  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-muted">Weekly billing</h2>
        {s.status === 'completed' && (
          <div className="flex flex-wrap gap-2">
            <DownloadSoaButton scope={scope} rentalId={rentalId} />
            <Link
              to={scope === 'me' ? '/account/bookings/$bookingId/statement' : '/app/bookings/$bookingId/statement'}
              params={{ bookingId: rentalId }} className={buttonClass('secondary')}>View statement of account</Link>
          </div>
        )}
      </div>
      {s.weeks.length === 0 ? (
        <p className="text-sm text-text-muted">No hours billed yet. Each week's reconciled hours stack up here.</p>
      ) : (
        <WeeksTable statement={s} />
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
        <span className="text-text-muted">Balance due</span>
        <span className="font-mono text-heading-md tabular-nums text-text">{formatPeso(s.totals.balanceDue)}</span>
      </div>
    </Surface>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={['flex items-center justify-between gap-3 text-sm', strong ? 'border-t border-border pt-2 font-semibold' : ''].join(' ')}>
      <span className={strong ? 'text-text' : 'text-text-muted'}>{label}</span>
      <span className="font-mono tabular-nums text-text">{value}</span>
    </div>
  );
}

function StatementPage({ scope, rentalId }: { scope: Scope; rentalId: string }) {
  const statement = useQuery(statementQuery(scope, rentalId));
  const back = scope === 'me' ? '/account/bookings/$bookingId' : '/app/bookings/$bookingId';
  const s = statement.data;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div data-print-hide>
        <PageHeader
          title="Statement of account"
          {...(s?.bookingCode ? { description: `Booking ${s.bookingCode}` } : {})}
          actions={
            <>
              <Link to={back} params={{ bookingId: rentalId }} className={buttonClass('ghost')}>Back to booking</Link>
              {s && scope === 'staff' && <EmailSoaButton rentalId={rentalId} statement={s} />}
              <DownloadSoaButton scope={scope} rentalId={rentalId} variant="secondary" />
              <Button variant="primary" disabled={!s} onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        />
      </div>
      {statement.isError && <p className="text-sm text-error">{apiErrorText(statement.error)}</p>}
      {!s && !statement.isError && <p className="text-sm text-text-muted">Loading statement...</p>}
      {s && (
        <>
          <PrintFrame
            title="Statement of account"
            docRef={`SOA-${s.bookingCode ?? s.rentalId.slice(0, 8).toUpperCase()}`}
            issuedAt={s.generatedAt}
            details={[
              ['Account', s.company?.name ?? '--'],
              ['Customer TIN', s.company?.tin ?? '--'],
              ['Billing address', s.company?.billingAddress ?? '--'],
              ['Booking', s.bookingCode ?? '--'],
              ['Rental period', s.rentalEnd ? range(s.rentalStart, s.rentalEnd) : `From ${formatDate(s.rentalStart)}`],
              ['Status', formatStatus(s.status)],
              ['Balance due', formatPeso(s.totals.balanceDue)],
            ]}
          />
          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5 print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-heading-md text-text">Hours by week</h2>
            {s.weeks.length ? <WeeksTable statement={s} /> : <p className="text-sm text-text-muted">No reconciled hours.</p>}
          </Surface>
          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5 print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-heading-md text-text">Invoices</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">Invoice</th>
                  <th className="py-2 pr-3 font-medium">Issued</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.invoices.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono">{shortCode('invoice', i.id)}</span> · {formatInvoiceType(i.invoiceType)}
                    </td>
                    <td className="py-2 pr-3">{formatDate(i.createdAt)}</td>
                    <td className="py-2 pr-3">{formatStatus(i.status)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{formatPeso(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5 print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-heading-md text-text">Payments</h2>
            {s.payments.filter((p) => p.status === 'paid').length === 0 ? (
              <p className="text-sm text-text-muted">No payments recorded.</p>
            ) : (
              s.payments
                .filter((p) => p.status === 'paid')
                .map((p) => (
                  <Row key={p.id} label={`${formatDate(p.createdAt)} · ${formatStatus(p.method)} · ${shortCode('invoice', p.invoiceId)}`} value={formatPeso(p.amount)} />
                ))
            )}
          </Surface>
          <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5 print:border-0 print:p-0 print:shadow-none">
            <h2 className="text-heading-md text-text">Summary</h2>
            <Row label="Deposit held" value={formatPeso(s.deposit.required)} />
            <Row label="Used from the deposit" value={formatPeso(s.deposit.deducted)} />
            <Row label="Deposit remaining" value={formatPeso(s.deposit.remaining)} />
            <Row label="Total invoiced" value={formatPeso(s.totals.charged)} />
            <Row label="Total paid" value={formatPeso(s.totals.paid)} />
            {s.totals.unbilled > 0 && <Row label="Hours not yet invoiced" value={formatPeso(s.totals.unbilled)} />}
            <Row label="Balance due" value={formatPeso(s.totals.balanceDue)} strong />
          </Surface>
        </>
      )}
    </div>
  );
}

export const accountStatementRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/bookings/$bookingId/statement',
  component: function AccountStatement() {
    return <StatementPage scope="me" rentalId={accountStatementRoute.useParams().bookingId} />;
  },
});

export const appStatementRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/bookings/$bookingId/statement',
  component: function AppStatement() {
    return <StatementPage scope="staff" rentalId={appStatementRoute.useParams().bookingId} />;
  },
});
