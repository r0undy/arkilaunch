import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { explainEdtrError } from '../lib/edtr-error.js';
import {
  formatDate,
  formatHours,
  formatLogSource,
  formatPeso,
  formatStatus,
  shortCode,
  siteName,
} from '../lib/format.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { BookingCode } from '../components/booking-code.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { CaptureModal } from '../components/capture-modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { PageHeader } from '../components/page-header.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { AlertIcon, CheckIcon, ClockIcon, XCircleIcon } from '../components/icons.js';
import { EmptyState } from '../components/empty-state.js';
import { ClipboardList } from 'lucide-react';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Table, type TableColumn } from '../components/table.js';
import { useToast } from '../components/toast.js';

// The day's work, as the office sees it: a queue of field logs with the ones
// needing a decision at the top. Recording a log and approving one are both
// modals opened from here, so nobody has to copy an identifier between two
// standing forms -- which is what the previous version of this screen asked
// for, and why its Approve button only worked on a log captured seconds
// earlier.
const APPROVABLE = new Set(['matched', 'discrepancy']);

interface EdtrListItem {
  id: string;
  rentalId: string;
  equipmentId: string;
  source: 'paper_ocr' | 'digital_entry';
  reportDate: string;
  status: string;
  reconciliation: {
    id: string;
    status: string;
    deltaHours: number | null;
    tolerance: number;
  } | null;
}

// Reconciliation states read differently from record states: 'pending' here
// means "the second log has not arrived", not "queued for processing".
const MATCH_LABELS: Record<string, string> = {
  pending: 'Waiting for the second log',
  single_source: 'Waiting for the second log',
  matched: 'Both logs agree',
  discrepancy: 'Logs disagree',
  unreadable: 'One log is unreadable',
  approved: 'Billed',
};

function matchLabel(status: string): string {
  return MATCH_LABELS[status] ?? formatStatus(status);
}

function statusPill(status: string): { tone: StatusTone; icon: ReactNode } {
  if (status === 'reconciled')
    return { tone: 'recon-match', icon: <CheckIcon className="h-4 w-4" aria-hidden /> };
  if (status === 'review')
    return { tone: 'recon-review', icon: <AlertIcon className="h-4 w-4" aria-hidden /> };
  if (status === 'hard_failed')
    return { tone: 'recon-failed', icon: <XCircleIcon className="h-4 w-4" aria-hidden /> };
  return { tone: 'recon-review', icon: <ClockIcon className="h-4 w-4" aria-hidden /> };
}

function MatchText({ row }: { row: EdtrListItem }) {
  if (!row.reconciliation) return <span className="text-text-muted">--</span>;
  const { status, deltaHours, tolerance } = row.reconciliation;
  if (status === 'approved') return <span className="text-text-muted">Billed</span>;
  if (deltaHours === null) return <>{matchLabel(status)}</>;
  return (
    <span className={deltaHours > tolerance ?'text-error' : 'text-text'}>
      {matchLabel(status)} ({formatHours(deltaHours)} apart)
    </span>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function EdtrPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = edtrRoute.useSearch();

  const {
    equipmentList,
    rentals,
    rentalLabel,
    sites,
    error: refError,
  } = useScanDeployments();

  const [captureOpen, setCaptureOpen] = useState(false);
  const [approving, setApproving] = useState<EdtrListItem | null>(null);
  const [viewing, setViewing] = useState<EdtrListItem | null>(null);

  const [offset, setOffset] = useState(0);
  // A new filter starts from its first page.
  useEffect(() => setOffset(0), [search.site, search.equipment, search.week]);
  // Deep links from the dashboard's "Needs you" rows: one machine-week. The
  // filter goes to the API, so the pager counts the filtered rows rather than
  // filtering whichever page happened to load.
  const filters = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (search.equipment) filters.set('equipmentId', search.equipment);
  if (search.week) {
    filters.set('from', search.week);
    filters.set('to', addDaysIso(search.week, 6));
  }
  const queue = useQuery({
    queryKey: ['edtr', PAGE_SIZE, offset, search.equipment ?? '', search.week ?? ''] as const,
    queryFn: () => apiGet<{ items: EdtrListItem[]; total: number }>(`/edtr?${filters.toString()}`),
  });

  const equipmentById = useMemo(
    () => new Map(equipmentList.map((e) => [e.id, e])),
    [equipmentList],
  );

  function machineName(equipmentId: string): string {
    const match = equipmentById.get(equipmentId);
    return match ? match.model : `Machine ${shortCode('equipment', equipmentId)}`;
  }

  function onCaptured() {
    void queryClient.invalidateQueries({ queryKey: ['edtr'] });
  }

  // Equipment and week filter on the server; the site is not an API
  // filter, so it narrows the loaded page. One site runs many machines:
  // pick the site, then the machine list narrows to the ones logged there.
  // ponytail: move site to an API param if a site's queue spans pages.
  const rentalById = useMemo(() => new Map(rentals.map((r) => [r.id, r])), [rentals]);
  const siteOf = (rentalId: string) => rentalById.get(rentalId)?.projectSiteId;
  const all = queue.data?.items ?? [];
  const siteOptions = [...new Set(all.map((row) => siteOf(row.rentalId)).filter((id): id is string => !!id))];
  const equipmentOptions = [
    ...new Set(
      all.filter((row) => !search.site || siteOf(row.rentalId) === search.site).map((row) => row.equipmentId),
    ),
  ];
  const items = all.filter((row) => !search.site || siteOf(row.rentalId) === search.site);
  const filtered = Boolean(search.site || search.equipment || search.week);

  function setFilter(next: { site?: string | undefined; equipment?: string | undefined }) {
    void navigate({
      to: '/app/ocr',
      search: {
        ...(next.site ? { site: next.site } : {}),
        ...(next.equipment ? { equipment: next.equipment } : {}),
      },
    });
  }

  function rentalName(rentalId: string): string {
    const rental = rentalById.get(rentalId);
    return rental ? `${rental.code} · ${rentalLabel(rental)}` : 'Rental not in your list';
  }

  function siteLabel(siteId: string | undefined): string {
    const site = sites.find((x) => x.id === siteId);
    return site ? siteName(site) : 'Unknown site';
  }

  // Every rental group renders its own table; fixed widths keep their
  // columns on the same lines down the page.
  const columns: TableColumn<EdtrListItem>[] = [
    {
      header: 'Machine',
      kind: 'text',
      width: '28%',
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            onClick={() => setViewing(row)}
            className="truncate text-left font-medium text-accent hover:underline"
          >
            {machineName(row.equipmentId)}
          </button>
          <span className="font-mono text-xs text-text-muted">{shortCode('log', row.id)}</span>
        </div>
      ),
    },
    { header: 'Day worked', kind: 'date', width: '13%', cell: (row) => formatDate(row.reportDate) },
    { header: 'Recorded', kind: 'text', width: '13%', cell: (row) => formatLogSource(row.source) },
    {
      header: 'Status',
      kind: 'status',
      width: '14%',
      cell: (row) => {
        const pill = statusPill(row.status);
        return <StatusPill tone={pill.tone} icon={pill.icon} label={formatStatus(row.status)} />;
      },
    },
    { header: 'Match', kind: 'text', width: '18%', cell: (row) => <MatchText row={row} /> },
    {
      header: 'Actions',
      kind: 'action',
      width: '14%',
      cell: (row) =>
        row.reconciliation && APPROVABLE.has(row.reconciliation.status) ? (
          <Button variant="approve" size="field" onClick={() => setApproving(row)}>
            Review and bill
          </Button>
        ) : (
          <span className="text-text-muted">--</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Field logs"
        description="Each day's hours, recorded twice and matched before anything is billed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void navigate({ to: '/app/ocr/deployments' })}>
              Scan a DTR
            </Button>
            <Button variant="primary" onClick={() => setCaptureOpen(true)}>
              Record a field log
            </Button>
          </div>
        }
      />

      {refError != null && (
        <Surface radius="md" elevation="sm" className="border-error p-4">
          <p className="text-sm text-error">
            The machine and rental lists could not be loaded, so recording a log is unavailable
            right now.
          </p>
        </Surface>
      )}

      {queue.isSuccess && all.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <Select
            label="Site"
            value={search.site ?? ''}
            onChange={(e) => setFilter({ site: e.target.value || undefined })}
          >
            <option value="">All sites ({siteOptions.length})</option>
            {siteOptions.map((id) => (
              <option key={id} value={id}>
                {siteLabel(id)}
              </option>
            ))}
          </Select>
          <Select
            label="Equipment"
            value={search.equipment ?? ''}
            onChange={(e) => setFilter({ site: search.site, equipment: e.target.value || undefined })}
          >
            <option value="">
              All equipment{search.site ? ' at this site' : ''} ({equipmentOptions.length})
            </option>
            {equipmentOptions.map((id) => (
              <option key={id} value={id}>
                {machineName(id)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {filtered && (
        <p className="text-sm text-text-muted">
          Showing {items.length} log{items.length === 1 ? '' : 's'}
          {search.site ? ` at ${siteLabel(search.site)}` : ''}
          {search.equipment ? ` for ${machineName(search.equipment)}` : ''}
          {search.week ? ` in the week of ${formatDate(search.week)}` : ''}.{' '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => void navigate({ to: '/app/ocr', search: {} })}
          >
            Show all field logs
          </button>
        </p>
      )}

      {queue.isPending && <p className="text-sm text-text-muted">Loading field logs...</p>}

      {queue.isError && (
        <Surface radius="md" elevation="sm" className="flex flex-col gap-3 border-error p-4">
          <p className="text-sm text-error">Field logs could not be loaded just now.</p>
          <Button variant="secondary" onClick={() => void queue.refetch()}>
            Try again
          </Button>
        </Surface>
      )}

      {queue.isSuccess &&
        (items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing left here"
              description="No field logs for this machine and week. They may already be billed."
            />
          ) : (
          <EmptyState
            icon={ClipboardList}
            title="No field logs yet"
            description="Record the first one to start matching hours against the deposit."
            action={
              <Button variant="primary" onClick={() => setCaptureOpen(true)}>
                Record a field log
              </Button>
            }
          />
          )
        ) : (
          <div className="flex flex-col gap-3">
            {groupByRental(items).map(([rentalId, rows]) => (
              <RentalGroup
                key={rentalId}
                rentalId={rentalId}
                label={rentalName(rentalId)}
                siteId={siteOf(rentalId)}
                rows={rows}
                columns={columns}
                onOpen={setViewing}
              />
            ))}
          </div>
        ))}

      {queue.isSuccess && items.length > 0 && (
        <Pagination
          offset={offset}
          limit={PAGE_SIZE}
          total={queue.data.total}
          onOffsetChange={setOffset}
          noun="field logs"
          busy={queue.isFetching}
        />
      )}

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        rentals={rentals}
        equipmentList={equipmentList}
        rentalLabel={rentalLabel}
        onCaptured={onCaptured}
        toast={toast}
      />

      {viewing && (
        <FieldLogDrawer
          item={viewing}
          machine={machineName(viewing.equipmentId)}
          serialNo={equipmentById.get(viewing.equipmentId)?.serialNo}
          bookingCode={rentalById.get(viewing.rentalId)?.code}
          siteId={siteOf(viewing.rentalId)}
          siteLabel={siteLabel(siteOf(viewing.rentalId))}
          onClose={() => setViewing(null)}
          onReview={() => {
            setApproving(viewing);
            setViewing(null);
          }}
        />
      )}

      {approving && (
        <ApproveModal
          item={approving}
          machine={machineName(approving.equipmentId)}
          onClose={() => setApproving(null)}
          onApproved={() => {
            setApproving(null);
            void queryClient.invalidateQueries({ queryKey: ['edtr'] });
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

// Logs grouped by the rental (order) they bill against, in first-seen order.
function groupByRental(items: EdtrListItem[]): [string, EdtrListItem[]][] {
  const groups = new Map<string, EdtrListItem[]>();
  for (const item of items) groups.set(item.rentalId, [...(groups.get(item.rentalId) ?? []), item]);
  return [...groups];
}

interface DepositSummary {
  depositRequired: number | null;
  balanceRemaining: number | null;
  unbilledAccrued: number;
  hoursUsed: number;
  hoursOrdered: number | null;
}

// One rental: hours billed vs hours ordered and what is left on the
// deposit, with its logs underneath. Native <details> is the collapse.
function RentalGroup({
  rentalId,
  label,
  siteId,
  rows,
  columns,
  onOpen,
}: {
  rentalId: string;
  label: string;
  siteId: string | undefined;
  rows: EdtrListItem[];
  columns: TableColumn<EdtrListItem>[];
  onOpen: (row: EdtrListItem) => void;
}) {
  const ledger = useQuery({
    queryKey: ['edtr', 'deposit', rentalId] as const,
    queryFn: () => apiGet<DepositSummary>(`/rentals/${rentalId}/deposit`),
  });
  const d = ledger.data;
  return (
    <details open className="rounded-md border border-border" data-testid="rental-group">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-text">{label}</span>
          {siteId && (
            <Link
              to="/app/deployment/$siteId"
              params={{ siteId }}
              search={{ tab: 'logs' }}
              className="text-sm font-medium text-accent hover:underline"
            >
              Open site
            </Link>
          )}
        </span>
        <span className="flex flex-wrap gap-4 text-sm text-text-muted">
          <span>
            {rows.length} log{rows.length === 1 ? '' : 's'}
          </span>
          {d && (
            <>
              <span data-testid="rental-hours">
                {formatHours(d.hoursUsed)} used
                {d.hoursOrdered != null ? ` of ${formatHours(d.hoursOrdered)} ordered` : ''}
              </span>
              <span data-testid="rental-deposit">Deposit left {formatPeso(d.balanceRemaining)}</span>
              {d.unbilledAccrued > 0 && (
                <span className="text-error">{formatPeso(d.unbilledAccrued)} on the next weekly invoice</span>
              )}
            </>
          )}
        </span>
      </summary>
      <Table
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        onRowClick={onOpen}
        rowLabel={(row) => `Open field log ${shortCode('log', row.id)}`}
      />
    </details>
  );
}

const drawerHeading = 'text-xs font-semibold text-text-muted';

// One field log, read without leaving the queue (DSD drawer rule): what was
// recorded, how it matched, and where it belongs -- the booking and the site
// are links, the bill action hands off to the approve modal.
function FieldLogDrawer({
  item,
  machine,
  serialNo,
  bookingCode,
  siteId,
  siteLabel,
  onClose,
  onReview,
}: {
  item: EdtrListItem;
  machine: string;
  serialNo: string | undefined;
  bookingCode: string | undefined;
  siteId: string | undefined;
  siteLabel: string;
  onClose: () => void;
  onReview: () => void;
}) {
  const pill = statusPill(item.status);
  const canBill = !!item.reconciliation && APPROVABLE.has(item.reconciliation.status);
  const rows: [string, ReactNode][] = [
    ['Machine', serialNo ? `${machine} · SN ${serialNo}` : machine],
    ['Day worked', formatDate(item.reportDate)],
    ['Recorded', formatLogSource(item.source)],
    ['Status', <StatusPill key="s" tone={pill.tone} icon={pill.icon} label={formatStatus(item.status)} />],
    ['Match', <MatchText key="m" row={item} />],
    [
      'Tolerance',
      item.reconciliation ? <span className="font-mono tabular-nums">{formatHours(item.reconciliation.tolerance)}</span> : '--',
    ],
    ['Booking', bookingCode ? <BookingCode key="b" code={bookingCode} copyable /> : '--'],
    [
      'Site',
      siteId ? (
        <Link
          key="site"
          to="/app/deployment/$siteId"
          params={{ siteId }}
          search={{ tab: 'equipment' }}
          className="font-medium text-accent hover:underline"
        >
          {siteLabel}
        </Link>
      ) : (
        siteLabel
      ),
    ],
  ];
  return (
    <Modal
      open
      onClose={onClose}
      placement="right"
      size="md"
      title={`Field log ${shortCode('log', item.id)}`}
      description={machine}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {bookingCode && (
            <Link to="/app/bookings" search={{ open: bookingCode }}>
              <Button variant="ghost">Open booking</Button>
            </Link>
          )}
          {canBill && (
            <Button variant="approve" onClick={onReview}>
              Review and bill
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className={drawerHeading}>{label}</dt>
            <dd className="text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// ------------------------------------------------------------------- approve

interface ApproveModalProps {
  item: EdtrListItem;
  machine: string;
  onClose: () => void;
  onApproved: () => void;
  toast: ReturnType<typeof useToast>;
}

interface ApproveResult {
  deposit?: { balanceBefore: number; deducted: number; accrued?: number; balanceAfter: number };
}

function ApproveModal({ item, machine, onClose, onApproved, toast }: ApproveModalProps) {
  const [adjActive, setAdjActive] = useState('');
  const [adjIdle, setAdjIdle] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const recon = item.reconciliation!;
  const disagrees = recon.status === 'discrepancy';
  const adjusted = adjActive !== '' && adjIdle !== '';

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await apiPost<ApproveResult>(`/edtr/reconciliations/${recon.id}/approve`, {
        reconciliationId: recon.id,
        adjustments: adjusted
          ? { hoursActive: Number(adjActive), hoursIdle: Number(adjIdle) }
          : null,
      });
      const deducted = res.deposit?.deducted;
      toast.success(
        'Hours billed to the deposit',
        deducted != null
          ? `${machine}, ${formatDate(item.reportDate)} - ${new Intl.NumberFormat('en-PH', {
              style: 'currency',
              currency: 'PHP',
            }).format(deducted)} deducted.${
              res.deposit?.accrued ? ` ${formatPeso(res.deposit.accrued)} past the deposit goes on the weekly invoice.` : ''
            }`
          : undefined,
      );
      setConfirming(false);
      onApproved();
    } catch (err) {
      setError(err);
      const { title, detail } = explainEdtrError(err);
      toast.error(title, detail);
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  const explained = error != null ? explainEdtrError(error) : null;

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title="Review and bill"
        description={`${machine} - ${formatDate(item.reportDate)}`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Not now
            </Button>
            <Button
              variant="approve"
              onClick={() => setConfirming(true)}
              disabled={disagrees && !adjusted}
            >
              Bill these hours
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Surface radius="md" elevation="sm" className="flex flex-col gap-1 p-3">
            <p className="text-sm text-text">
              {disagrees
                ? 'The two records of this day do not agree.'
                : 'Both records of this day agree, within tolerance.'}
            </p>
            {recon.deltaHours !== null && (
              <p className="text-sm text-text-muted">
                They differ by {formatHours(recon.deltaHours)}. Anything over{' '}
                {formatHours(recon.tolerance)} needs a person to decide.
              </p>
            )}
          </Surface>

          {disagrees && (
            <>
              <p className="text-sm text-text">
                Enter the hours you are approving. Nothing is billed until you do -- this is the
                decision the system will not make on its own.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  numeric
                  id="adjActive"
                  label="Hours working to bill"
                  type="number"
                  step="0.25"
                  value={adjActive}
                  onChange={(e) => setAdjActive(e.target.value)}
                />
                <Input
                  numeric
                  id="adjIdle"
                  label="Hours idle to record"
                  type="number"
                  step="0.25"
                  value={adjIdle}
                  onChange={(e) => setAdjIdle(e.target.value)}
                />
              </div>
            </>
          )}

          {explained && (
            <Surface radius="md" elevation="sm" className="border-error p-3">
              <p className="text-sm font-semibold text-error">{explained.title}</p>
              <p className="mt-1 text-sm text-text">{explained.detail}</p>
            </Surface>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title="Bill these hours?"
        tone="approve"
        pending={pending}
        confirmLabel="Yes, bill them"
        cancelLabel="Go back"
        body={
          <>
            <p>
              This deducts from the customer's deposit for <strong>{machine}</strong> on{' '}
              <strong>{formatDate(item.reportDate)}</strong>.
            </p>
            {adjusted && (
              <p className="mt-2">
                Billing {formatHours(Number(adjActive))} working and {formatHours(Number(adjIdle))}{' '}
                idle, as you entered.
              </p>
            )}
            <p className="mt-2 text-text-muted">
              It is recorded against your name and cannot be undone here.
            </p>
          </>
        }
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export const edtrRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/ocr',
  // Shapes the API accepts (uuid, YYYY-MM-DD); anything else is dropped
  // rather than turned into a 400.
  validateSearch: (search: Record<string, unknown>): { site?: string; equipment?: string; week?: string } => ({
    ...(typeof search.site === 'string' && UUID.test(search.site) ? { site: search.site } : {}),
    ...(typeof search.equipment === 'string' && UUID.test(search.equipment) ? { equipment: search.equipment } : {}),
    ...(typeof search.week === 'string' && /^d{4}-d{2}-d{2}$/.test(search.week) ? { week: search.week } : {}),
  }),
  component: EdtrPage,
});
