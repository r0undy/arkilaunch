import { createRoute } from '@tanstack/react-router';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EdtrCaptureResponse, EdtrDetailResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { apiGet, apiPost, apiPostForm } from '../lib/api-client.js';
import {
  getCustomers,
  getEquipment,
  getProjectSites,
  getRentals,
  type CustomerRef,
  type EquipmentRef,
  type ProjectSiteRef,
  type RentalRef,
} from '../lib/reference-client.js';
import { explainEdtrError } from '../lib/edtr-error.js';
import {
  formatDate,
  formatHours,
  formatLogSource,
  formatStatus,
  shortCode,
  siteName,
} from '../lib/format.js';
import { Button } from '../components/button.js';
import { CaptureField } from '../components/capture-field.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { PageHeader } from '../components/page-header.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { AlertIcon, CheckIcon, ClockIcon, XCircleIcon } from '../components/icons.js';
import { EmptyState } from '../components/empty-state.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Table } from '../components/table.js';
import { ConfidenceChip } from '../components/confidence-chip.js';
import { useToast } from '../components/toast.js';

// The day's work, as the office sees it: a queue of field logs with the ones
// needing a decision at the top. Recording a log and approving one are both
// modals opened from here, so nobody has to copy an identifier between two
// standing forms -- which is what the previous version of this screen asked
// for, and why its Approve button only worked on a log captured seconds
// earlier.
const TERMINAL_STATUSES = new Set(['review', 'reconciled', 'hard_failed']);
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

function EdtrPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [equipmentList, setEquipmentList] = useState<EquipmentRef[]>([]);
  const [rentals, setRentals] = useState<RentalRef[]>([]);
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [sites, setSites] = useState<ProjectSiteRef[]>([]);
  const [refError, setRefError] = useState<unknown>(null);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [approving, setApproving] = useState<EdtrListItem | null>(null);

  const [offset, setOffset] = useState(0);
  const queue = useQuery({
    queryKey: ['edtr', PAGE_SIZE, offset] as const,
    queryFn: () =>
      apiGet<{ items: EdtrListItem[]; total: number }>(`/edtr?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  useEffect(() => {
    Promise.all([getEquipment(), getRentals(), getCustomers(), getProjectSites()])
      .then(([e, r, c, s]) => {
        setEquipmentList(e);
        setRentals(r);
        setCustomers(c);
        setSites(s);
      })
      .catch(setRefError);
  }, []);

  const equipmentById = useMemo(
    () => new Map(equipmentList.map((e) => [e.id, e])),
    [equipmentList],
  );

  function machineName(equipmentId: string): string {
    const match = equipmentById.get(equipmentId);
    return match ? match.model : `Machine ${shortCode('equipment', equipmentId)}`;
  }

  /** A rental named by who it is for and where, not by its id. */
  function rentalLabel(rental: RentalRef): string {
    const customer = customers.find((c) => c.id === rental.customerId)?.companyName;
    const site = sites.find((s) => s.id === rental.projectSiteId);
    const where = site ? siteName(site) : null;
    const who = customer ?? 'Unnamed customer';
    return [who, where].filter(Boolean).join(' - ');
  }

  function onCaptured() {
    void queryClient.invalidateQueries({ queryKey: ['edtr'] });
  }

  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Field logs"
        description="Each day's hours, recorded twice and matched before anything is billed."
        actions={
          <Button variant="primary" onClick={() => setCaptureOpen(true)}>
            Record a field log
          </Button>
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
          <EmptyState
            title="No field logs yet"
            description="Record the first one to start matching hours against the deposit."
            action={
              <Button variant="primary" onClick={() => setCaptureOpen(true)}>
                Record a field log
              </Button>
            }
          />
        ) : (
          <Table
            rows={items}
            rowKey={(row) => row.id}
            columns={[
              {
                header: 'Machine',
                cell: (row) => (
                  <div className="flex flex-col">
                    <span className="text-text">{machineName(row.equipmentId)}</span>
                    <span className="font-mono text-xs text-text-muted">
                      {shortCode('log', row.id)}
                    </span>
                  </div>
                ),
              },
              { header: 'Day worked', cell: (row) => formatDate(row.reportDate) },
              { header: 'Recorded', cell: (row) => formatLogSource(row.source) },
              {
                header: 'Status',
                cell: (row) => {
                  const pill = statusPill(row.status);
                  return (
                    <StatusPill
                      tone={pill.tone}
                      icon={pill.icon}
                      label={formatStatus(row.status)}
                    />
                  );
                },
              },
              {
                header: 'Match',
                cell: (row) => {
                  if (!row.reconciliation) return <span className="text-text-muted">--</span>;
                  const { status, deltaHours } = row.reconciliation;
                  if (status === 'approved') return <span className="text-text-muted">Billed</span>;
                  if (deltaHours === null) return matchLabel(status);
                  return (
                    <span
                      className={
                        deltaHours > row.reconciliation.tolerance ? 'text-error' : 'text-text'
                      }
                    >
                      {matchLabel(status)} ({formatHours(deltaHours)} apart)
                    </span>
                  );
                },
              },
              {
                header: '',
                align: 'right',
                cell: (row) =>
                  row.reconciliation && APPROVABLE.has(row.reconciliation.status) ? (
                    <Button variant="approve" size="field" onClick={() => setApproving(row)}>
                      Review and bill
                    </Button>
                  ) : null,
              },
            ]}
          />
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

// ------------------------------------------------------------------- capture

interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
  rentals: RentalRef[];
  equipmentList: EquipmentRef[];
  rentalLabel: (rental: RentalRef) => string;
  onCaptured: () => void;
  toast: ReturnType<typeof useToast>;
}

function CaptureModal({
  open,
  onClose,
  rentals,
  equipmentList,
  rentalLabel,
  onCaptured,
  toast,
}: CaptureModalProps) {
  const [source, setSource] = useState<'digital_entry' | 'paper_ocr'>('digital_entry');
  const [rentalId, setRentalId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [hoursActive, setHoursActive] = useState('8');
  const [hoursIdle, setHoursIdle] = useState('0');
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [pollUrl, setPollUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<EdtrDetailResponse | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (rentals[0] && !rentalId) setRentalId(rentals[0].id);
    if (equipmentList[0] && !equipmentId) setEquipmentId(equipmentList[0].id);
  }, [rentals, equipmentList, rentalId, equipmentId]);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  useEffect(() => {
    if (!pollUrl) return;
    async function tick() {
      try {
        const res = await apiGet<EdtrDetailResponse>(pollUrl!);
        setDetail(res);
        if (TERMINAL_STATUSES.has(res.status)) {
          stopPolling();
          onCaptured();
        }
      } catch (err) {
        setError(err);
        stopPolling();
      }
    }
    void tick();
    pollTimer.current = setInterval(tick, 3000);
    return stopPolling;
  }, [pollUrl, onCaptured]);

  function reset() {
    stopPolling();
    setPollUrl(null);
    setDetail(null);
    setError(null);
    setScanFile(null);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let res: EdtrCaptureResponse;
      if (source === 'digital_entry') {
        res = await apiPost<EdtrCaptureResponse>('/edtr', {
          source: 'digital_entry',
          rentalId,
          equipmentId,
          reportDate,
          lineItems: { hoursActive: Number(hoursActive), hoursIdle: Number(hoursIdle) },
        });
      } else {
        // Multipart carries strings only, so transcribed hours travel as a
        // JSON-encoded field the API decodes back into an object.
        const transcribed =
          hoursActive !== '' && hoursIdle !== ''
            ? {
                lineItems: JSON.stringify({
                  hoursActive: Number(hoursActive),
                  hoursIdle: Number(hoursIdle),
                }),
              }
            : {};
        res = await apiPostForm<EdtrCaptureResponse>(
          '/edtr',
          { source: 'paper_ocr', rentalId, equipmentId, reportDate, ...transcribed },
          scanFile ?? undefined,
        );
      }
      setPollUrl(res.pollUrl);
      toast.success(
        'Field log recorded',
        `${formatDate(reportDate)} - waiting for its matching log.`,
      );
      onCaptured();
    } catch (err) {
      setError(err);
      const { title, detail: why } = explainEdtrError(err);
      toast.error(title, why);
    } finally {
      setSubmitting(false);
    }
  }

  const explained = error != null ? explainEdtrError(error) : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Record a field log"
      description="One day, one machine. Record it twice from two sources and the hours are matched before billing."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {detail ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" onClick={capture} loading={submitting} disabled={!reportDate}>
            Record log
          </Button>
        </>
      }
    >
      <form onSubmit={capture} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">How was it recorded?</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex min-h-11 items-center gap-2 text-text">
              <input
                type="radio"
                name="source"
                value="digital_entry"
                checked={source === 'digital_entry'}
                onChange={() => setSource('digital_entry')}
                className="h-5 w-5 accent-accent"
              />
              Typed in from the office
            </label>
            <label className="flex min-h-11 items-center gap-2 text-text">
              <input
                type="radio"
                name="source"
                value="paper_ocr"
                checked={source === 'paper_ocr'}
                onChange={() => setSource('paper_ocr')}
                className="h-5 w-5 accent-accent"
              />
              Photo of the paper sheet
            </label>
          </div>
        </fieldset>

        <Select
          id="rentalId"
          label="Rental"
          value={rentalId}
          onChange={(e) => setRentalId(e.target.value)}
          required
        >
          {rentals.length === 0 && <option value="">No rentals available</option>}
          {rentals.map((r) => (
            <option key={r.id} value={r.id}>
              {rentalLabel(r)} ({shortCode('rental', r.id)})
            </option>
          ))}
        </Select>

        <Select
          id="equipmentId"
          label="Machine"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          required
        >
          {equipmentList.length === 0 && <option value="">No machines available</option>}
          {equipmentList.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.model} ({eq.serialNo})
            </option>
          ))}
        </Select>

        <Input
          id="reportDate"
          label="Day worked"
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          required
        />

        {source === 'paper_ocr' && (
          <CaptureField
            id="scanFile"
            label="Photo of the sheet"
            accept="image/*"
            size="field"
            value={scanFile}
            onChange={setScanFile}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            numeric
            id="hoursActive"
            label="Hours working"
            type="number"
            step="0.25"
            value={hoursActive}
            onChange={(e) => setHoursActive(e.target.value)}
          />
          <Input
            numeric
            id="hoursIdle"
            label="Hours idle"
            type="number"
            step="0.25"
            value={hoursIdle}
            onChange={(e) => setHoursIdle(e.target.value)}
          />
        </div>
        {source === 'paper_ocr' && (
          <p className="-mt-2 text-sm text-text-muted">
            Type the hours exactly as written on the sheet. The photo is kept either way, so the
            original can always be checked against what was billed.
          </p>
        )}

        {explained && (
          <Surface radius="md" elevation="sm" className="border-error p-3">
            <p className="text-sm font-semibold text-error">{explained.title}</p>
            <p className="mt-1 text-sm text-text">{explained.detail}</p>
          </Surface>
        )}

        {detail && (
          <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-3">
            <p className="text-sm text-text">
              Recorded as <span className="font-mono text-xs">{shortCode('log', detail.id)}</span> -{' '}
              {formatStatus(detail.status)}.
            </p>
            {detail.lineItems[0] && (
              <p className="text-sm text-text-muted">
                {formatHours(detail.lineItems[0].hoursActive)} working,{' '}
                {formatHours(detail.lineItems[0].hoursIdle)} idle.
              </p>
            )}
            {detail.fields.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.fields.map((field) => (
                  <ConfidenceChip
                    key={field.name}
                    fieldLabel={field.name}
                    confidence={field.confidence}
                    tone={field.belowGate ? 'review' : 'match'}
                  />
                ))}
              </div>
            )}
            {detail.reconciliation?.status === 'single_source' && (
              <p className="text-sm text-text-muted">
                Waiting for the second record of this machine-day before anything can be billed.
              </p>
            )}
          </Surface>
        )}
      </form>
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
  deposit?: { balanceBefore: number; deducted: number; balanceAfter: number };
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
            }).format(deducted)} deducted.`
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
  component: EdtrPage,
});
