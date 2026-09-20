import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { explainEdtrError } from '../lib/edtr-error.js';
import {
  formatDate,
  formatHours,
  formatLogSource,
  formatStatus,
  shortCode,
} from '../lib/format.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { Modal } from '../components/modal.js';
import { CaptureModal } from '../components/capture-modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { PageHeader } from '../components/page-header.js';
import { StatusPill, type StatusTone } from '../components/status-pill.js';
import { AlertIcon, CheckIcon, ClockIcon, XCircleIcon } from '../components/icons.js';
import { EmptyState } from '../components/empty-state.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Table } from '../components/table.js';
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

function EdtrPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    equipmentList,
    rentals,
    rentalLabel,
    error: refError,
  } = useScanDeployments();

  const [captureOpen, setCaptureOpen] = useState(false);
  const [approving, setApproving] = useState<EdtrListItem | null>(null);

  const [offset, setOffset] = useState(0);
  const queue = useQuery({
    queryKey: ['edtr', PAGE_SIZE, offset] as const,
    queryFn: () =>
      apiGet<{ items: EdtrListItem[]; total: number }>(`/edtr?limit=${PAGE_SIZE}&offset=${offset}`),
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

  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
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
