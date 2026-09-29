import { createRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { CircleCheck, CircleDashed, CircleX, Clock, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REVIEW_FLAGS,
  manilaDate,
  type FieldLogDay,
  type FieldLogDayStatus,
  type FieldLogUnit,
  type ReviewFlag,
  type SiteHubResponse,
} from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { edtrQueries, sitesQueries } from '../lib/queries.js';
import { apiDelete, apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso, formatStatus } from '../lib/format.js';
import { useScanDeployments } from '../lib/use-scan-deployments.js';
import { BookingCode } from '../components/booking-code.js';
import { Button } from '../components/button.js';
import { CaptureModal } from '../components/capture-modal.js';
import { HourFields, hourValuesFrom, toLineItems, type HourFieldValues, EMPTY_HOURS } from '../components/hour-fields.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { PageHeader } from '../components/page-header.js';
import { Tabs } from '../components/tabs.js';
import { Select } from '../components/select.js';
import { Container } from '../components/container.js';
import { Alert } from '../components/alert.js';
import { StatusBadge } from '../components/status-badge.js';
import { ExpandableSection } from '../components/expandable-section.js';
import { useMediaQuery } from '../lib/use-media-query.js';
import { Table, type TableColumn } from '../components/table.js';
import { SiteEquipmentWeather } from '../components/equipment-weather.js';
import { useToast } from '../components/toast.js';

// The per-site hub (cr-arkilaunch-edtr-site-hub-approval.md §7). Everything
// about one project site in five tabs; the Daily logs tab is where the
// office approves what timekeepers submit.

const TABS = ['overview', 'logs', 'equipment', 'personnel', 'documents'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  logs: 'Daily logs',
  equipment: 'Equipment',
  personnel: 'Personnel',
  documents: 'Documents',
};

// Each day is a status indicator (Cloudscape): the icon carries the colour and
// the label is spoken and shown on hover, so a week reads as a row of marks
// rather than seven chips of text.
const STATUS_META: Record<FieldLogDayStatus, { label: string; icon: LucideIcon; className: string }> = {
  missing: { label: 'Missing', icon: CircleDashed, className: 'text-text-muted' },
  pending: { label: 'Pending', icon: Clock, className: 'text-accent' },
  needs_correction: { label: 'Needs correction', icon: TriangleAlert, className: 'text-warning' },
  approved: { label: 'Approved', icon: CircleCheck, className: 'text-success' },
  rejected: { label: 'Rejected', icon: CircleX, className: 'text-error' },
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday of the week holding `iso`.
export function weekStartOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

function inSpan(unit: FieldLogUnit, date: string): boolean {
  return date >= unit.span.from && (unit.span.to === null || date <= unit.span.to);
}

// Day X of Y through a rental, clamped to the span.
export function spanProgress(start: string, end: string | null, today: string): { day: number; of: number | null } {
  const from = manilaDate(start);
  const dayIndex = (a: string, b: string) =>
    Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const of = end ? dayIndex(from, manilaDate(end)) : null;
  const day = Math.max(0, Math.min(dayIndex(from, today), of ?? Number.MAX_SAFE_INTEGER));
  return { day, of };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border p-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-mono text-heading-md text-text">{value}</span>
    </div>
  );
}

function Overview({ hub, today }: { hub: SiteHubResponse; today: string }) {
  const t = hub.totals;
  const { latitude, longitude } = hub.site;
  return (
    <div className="flex flex-col gap-4">
      <Container header={{ title: 'Site' }}>
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-text">{hub.site.address || '--'}</p>
          <p className="text-text-muted">Customer: {hub.site.customerName ?? '--'}</p>
          <ExpandableSection header={<span className="text-sm font-medium">Location details</span>}>
            <p className="font-mono text-sm tabular-nums text-text">
              {latitude.toFixed(4)}, {longitude.toFixed(4)}
            </p>
            <a
              className="text-sm text-accent underline"
              href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open the map
            </a>
          </ExpandableSection>
        </div>
      </Container>
      <Container header={{ title: 'Bookings on this site', count: hub.rentals.length }}>
        <div className="flex flex-col gap-3">
          {hub.rentals.length === 0 && <p className="text-sm text-text-muted">No bookings yet.</p>}
          {hub.rentals.map((r) => {
            const p = spanProgress(r.start, r.end, today);
            const pct = p.of ? Math.round((p.day / p.of) * 100) : null;
            return (
              <div key={r.id} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to="/app/bookings" search={{ open: r.code }} className="underline">
                    <BookingCode code={r.code} />
                  </Link>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm text-text">{r.customerName ?? '--'}</p>
                <p className="text-sm text-text-muted">
                  {formatDate(r.start)} – {r.end ? formatDate(r.end) : 'open'}
                  {r.extended && ' · extended'}
                  {p.of ? ` · day ${p.day} of ${p.of}` : ''}
                </p>
                {pct !== null && (
                  <div
                    className="h-1.5 w-full rounded-full bg-border"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label={`${r.code} rental progress`}
                  >
                    <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Container>
      <Container
        header={{ title: 'Approved field logs', description: `${t.daysApproved} of ${t.daysInSpan} machine-days approved` }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Running" value={`${t.running.toFixed(1)} h`} />
          <Stat label="Billable idle" value={`${t.idle.toFixed(1)} h`} />
          <Stat label="Downtime" value={`${(t.breakdown + t.weather + t.otherDowntime).toFixed(1)} h`} />
          <Stat label="Billed to date" value={formatPeso(t.billedPhp)} />
        </div>
      </Container>
      <Container header={{ title: 'Weather now' }}>
        <SiteEquipmentWeather siteId={hub.site.id} />
      </Container>
    </div>
  );
}

function ReviewPanel({
  day,
  unit,
  onClose,
  siteId,
}: {
  day: FieldLogDay | null;
  unit: FieldLogUnit | undefined;
  onClose: () => void;
  siteId: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const edtrId = day?.edtrId ?? null;
  const detail = useQuery({ ...edtrQueries.detail(edtrId ?? ''), enabled: !!edtrId });
  const image = useQuery({
    queryKey: ['edtr', edtrId, 'image'],
    queryFn: () => apiGet<{ url: string }>(`/edtr/${edtrId}/image`),
    enabled: !!edtrId && detail.data?.source === 'paper_ocr',
    retry: false,
  });
  const [values, setValues] = useState<HourFieldValues | null>(null);
  const [reason, setReason] = useState('');
  const item = detail.data?.lineItems[0];
  const shown = values ?? (item ? hourValuesFrom(item) : EMPTY_HOURS);
  const reviewable = day?.status === 'pending';

  const review = useMutation({
    mutationFn: (decision: 'approve' | 'needs_correction' | 'reject') => {
      if (decision === 'approve') {
        const hours = toLineItems(shown);
        if (!hours) throw new Error('Enter the running hours, and only numbers of zero or more.');
        return apiPost(`/edtr/${edtrId}/review`, { decision, hours });
      }
      return apiPost(`/edtr/${edtrId}/review`, { decision, reason });
    },
    onSuccess: async (_d, decision) => {
      await queryClient.invalidateQueries({ queryKey: sitesQueries.hub(siteId).queryKey });
      await queryClient.invalidateQueries({ queryKey: ['edtr'] });
      toast.success(
        decision === 'approve' ? 'Day approved' : decision === 'reject' ? 'Day rejected' : 'Correction requested',
        decision === 'approve' ? 'Billing, the hour meter and the customer page are updated.' : 'The timekeeper has been told.',
      );
      setValues(null);
      setReason('');
      onClose();
    },
    onError: (err) => toast.error('Could not save the review', err instanceof Error && !('status' in err) ? err.message : apiErrorText(err)),
  });

  return (
    <Modal
      open={!!day}
      onClose={() => {
        setValues(null);
        setReason('');
        onClose();
      }}
      placement="right"
      size="lg"
      title={day ? `${formatDate(day.date)} · ${unit?.name ?? 'Machine'}` : 'Field log'}
      description={day ? `${STATUS_META[day.status].label}${unit ? ` · ${unit.bookingCode}` : ''}` : ''}
      footer={
        reviewable ? (
          <>
            <Button
              variant="secondary"
              loading={review.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => review.mutate('reject')}
            >
              Reject
            </Button>
            <Button
              variant="secondary"
              loading={review.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => review.mutate('needs_correction')}
            >
              Request correction
            </Button>
            <Button variant="approve" loading={review.isPending} onClick={() => review.mutate('approve')}>
              Approve
            </Button>
          </>
        ) : undefined
      }
    >
      {day && !day.edtrId && (
        <p className="text-sm text-text-muted">
          Nothing was submitted for this day. Use Record EDTR to enter the paper sheet.
        </p>
      )}
      {detail.isError && <Alert type="error">{apiErrorText(detail.error)}</Alert>}
      {day?.edtrId && detail.data && (
        <div className="flex flex-col gap-4">
          {detail.data.source === 'paper_ocr' &&
            (image.data ? (
              <a href={image.data.url} target="_blank" rel="noreferrer">
                <img src={image.data.url} alt="Scanned field sheet" className="max-h-96 w-full rounded-md border border-border object-contain" />
              </a>
            ) : (
              <p className="text-sm text-text-muted">{image.isError ? 'The scan could not be loaded.' : 'Loading the scan...'}</p>
            ))}
          {day.submittedBy && <p className="text-sm text-text-muted">Submitted by {day.submittedBy}</p>}
          {day.flags.length > 0 && (
            <Alert type="warning" header="Check before approving">
              <ul className="list-disc pl-5">
                {day.flags.map((f) => (
                  <li key={f}>{REVIEW_FLAGS[f as ReviewFlag] ?? f}</li>
                ))}
              </ul>
            </Alert>
          )}
          {day.reason && <p className="text-sm text-text">Reason given: {day.reason}</p>}
          {reviewable ? (
            <>
              <p className="text-sm text-text-muted">
                The timekeeper's figures are filled in. Correct anything that differs from the sheet; what you approve is
                what is billed.
              </p>
              <HourFields value={shown} onChange={setValues} idPrefix="review" />
              <label className="flex flex-col gap-1 text-sm font-medium text-text">
                Reason (needed to reject or request a correction)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="rounded-input border border-border bg-surface p-2 text-base font-normal"
                />
              </label>
            </>
          ) : (
            day.hours && (
              <p className="text-sm text-text">
                Billed {day.hours.billable.toFixed(1)} h · running {day.hours.running.toFixed(1)} h · downtime{' '}
                {(day.hours.breakdown + day.hours.weather + day.hours.otherDowntime).toFixed(1)} h
              </p>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

function DailyLogs({ hub, today, siteId }: { hub: SiteHubResponse; today: string; siteId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(() => weekStartOf(today));
  const [open, setOpen] = useState<FieldLogDay | null>(null);
  const [recordRental, setRecordRental] = useState<string | null>(null);
  const { equipmentList, rentals, rentalLabel } = useScanDeployments(true);
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const byKey = useMemo(() => new Map(hub.days.map((d) => [`${d.equipmentId}|${d.date}`, d])), [hub.days]);

  // A clean pending day: the timekeeper's figures with nothing flagged.
  const clean = dates.flatMap((date) =>
    hub.units
      .map((u) => byKey.get(`${u.equipmentId}|${date}`))
      .filter((d): d is FieldLogDay => !!d && d.status === 'pending' && d.flags.length === 0 && !!d.edtrId),
  );
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const bulk = useMutation({
    mutationFn: async () => {
      let approved = 0;
      const failed: string[] = [];
      for (const day of clean) {
        try {
          const detail = await apiGet<{ lineItems: Parameters<typeof hourValuesFrom>[0][] }>(`/edtr/${day.edtrId}`);
          const hours = detail.lineItems[0] ? toLineItems(hourValuesFrom(detail.lineItems[0])) : null;
          if (!hours) throw new Error('no hours');
          await apiPost(`/edtr/${day.edtrId}/review`, { decision: 'approve', hours });
          approved += 1;
        } catch (err) {
          failed.push(`${formatDate(day.date)}: ${apiErrorText(err)}`);
        }
      }
      return { approved, failed };
    },
    onSuccess: async ({ approved, failed }) => {
      await queryClient.invalidateQueries({ queryKey: sitesQueries.hub(siteId).queryKey });
      if (failed.length) toast.error(`${approved} approved, ${failed.length} not`, failed.join(' · '));
      else toast.success(`${approved} days approved`, 'Billing and the hour meters are updated.');
    },
  });

  const lost = hub.totals.downtimeDays;
  return (
    <div className="flex flex-col gap-4">
      {lost > 0 && (
        <Alert type="warning" header={`${lost} full day${lost === 1 ? '' : 's'} lost to breakdown or weather`}>
          <p>Extend the rental so the customer is not charged for them.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {hub.rentals
              .filter((r) => r.status === 'active')
              .map((r) => (
                <Link key={r.id} to="/app/bookings/$bookingId" params={{ bookingId: r.id }}>
                  <Button variant="secondary">Extend {r.code}</Button>
                </Link>
              ))}
          </div>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
            ←
          </Button>
          <span className="text-sm font-semibold text-text">
            {formatDate(week)} – {formatDate(addDays(week, 6))}
          </span>
          <Button variant="ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
            →
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={clean.length === 0} loading={bulk.isPending} onClick={() => setBulkConfirm(true)}>
            Approve {clean.length} clean day{clean.length === 1 ? '' : 's'}
          </Button>
          <ConfirmDialog
            open={bulkConfirm}
            tone="approve"
            title={`Approve ${clean.length} clean day${clean.length === 1 ? '' : 's'}?`}
            body={
              <p>
                Each day is approved with the timekeeper&apos;s own hours, which become the office log for billing. Days
                with anything flagged are left for you to review one by one.
              </p>
            }
            confirmLabel="Approve them"
            pending={bulk.isPending}
            onConfirm={async () => {
              await bulk.mutateAsync().catch(() => undefined);
              setBulkConfirm(false);
            }}
            onCancel={() => setBulkConfirm(false)}
          />
          <Button
            variant="primary"
            disabled={hub.rentals.length === 0}
            onClick={() => setRecordRental(hub.rentals.find((r) => r.status === 'active')?.id ?? hub.rentals[0]!.id)}
          >
            Record EDTR
          </Button>
        </div>
      </div>
      {hub.units.length === 0 ? (
        <p className="text-sm text-text-muted">No machines are deployed to this site yet.</p>
      ) : (
        <WeekGrid hub={hub} dates={dates} byKey={byKey} onOpen={setOpen} />
      )}
      <ReviewPanel
        day={open}
        unit={open ? hub.units.find((u) => u.equipmentId === open.equipmentId) : undefined}
        onClose={() => setOpen(null)}
        siteId={siteId}
      />
      <CaptureModal
        open={!!recordRental}
        onClose={() => setRecordRental(null)}
        rentals={rentals.filter((r) => hub.rentals.some((h) => h.id === r.id))}
        equipmentList={equipmentList.filter((e) => hub.units.some((u) => u.equipmentId === e.id))}
        rentalLabel={rentalLabel}
        onCaptured={() => void queryClient.invalidateQueries({ queryKey: sitesQueries.hub(siteId).queryKey })}
        initialSource="paper_ocr"
        {...(recordRental ? { initialRentalId: recordRental } : {})}
      />
    </div>
  );
}

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' });

// One day of one machine: outside the rental, not yet due, or a status mark
// that opens the day's log.
function DayCell({ unit, date, day, onOpen }: { unit: FieldLogUnit; date: string; day: FieldLogDay | undefined; onOpen: (d: FieldLogDay) => void }) {
  if (!inSpan(unit, date)) {
    return (
      <span className="flex h-11 items-center justify-center text-text-muted" title="Outside the rental">
        <span aria-hidden>—</span>
        <span className="sr-only">{`${weekday(date)} ${formatDate(date)}: outside the rental`}</span>
      </span>
    );
  }
  if (!day) {
    return (
      <span className="flex h-11 items-center justify-center text-xs text-text-muted" title="Upcoming">
        <span aria-hidden>·</span>
        <span className="sr-only">{`${weekday(date)} ${formatDate(date)}: upcoming`}</span>
      </span>
    );
  }
  const meta = STATUS_META[day.status];
  const Icon = meta.icon;
  const label = `${unit.name}, ${weekday(date)} ${formatDate(date)}: ${meta.label}${day.flags.length ? ', flagged' : ''}`;
  return (
    <button
      type="button"
      onClick={() => onOpen(day)}
      title={`${meta.label}${day.flags.length ? ' (flagged)' : ''}`}
      aria-label={label}
      className="relative flex h-11 w-full items-center justify-center rounded-sm hover:bg-surface-sunk focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
    >
      <Icon aria-hidden className={`h-5 w-5 ${meta.className}`} />
      {day.flags.length > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error" />}
    </button>
  );
}

// The week as machines x days. On a phone each machine is a card with its
// seven days in one row, so nothing scrolls sideways.
function WeekGrid({
  hub,
  dates,
  byKey,
  onOpen,
}: {
  hub: SiteHubResponse;
  dates: string[];
  byKey: Map<string, FieldLogDay>;
  onOpen: (d: FieldLogDay) => void;
}) {
  const narrow = useMediaQuery('(max-width: 767px)');
  const legend = (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted" aria-label="Legend">
      {Object.values(STATUS_META).map(({ label, icon: Icon, className }) => (
        <li key={label} className="inline-flex items-center gap-1">
          <Icon aria-hidden className={`h-4 w-4 ${className}`} />
          {label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1">
        <span aria-hidden className="h-2 w-2 rounded-full bg-error" />
        Flagged
      </li>
    </ul>
  );
  const dayHead = (d: string) => (
    <>
      <span className="block">{weekday(d)}</span>
      <span className="font-mono text-xs tabular-nums">{Number(d.slice(8))}</span>
    </>
  );
  const unitName = (u: FieldLogUnit) => (
    <>
      <span className="block font-medium text-text">{u.name}</span>
      <span className="font-mono text-xs text-text-muted">{u.bookingCode}</span>
    </>
  );

  if (narrow) {
    return (
      <div className="flex flex-col gap-3">
        {legend}
        <Container flush>
          <ul>
            {hub.units.map((u) => (
              <li key={`${u.rentalId}-${u.equipmentId}`} className="border-b border-border px-4 py-3 last:border-0">
                {unitName(u)}
                <div className="mt-2 grid grid-cols-7 text-center text-xs text-text-muted">
                  {dates.map((d) => (
                    <div key={d}>
                      <div aria-hidden>{dayHead(d)}</div>
                      <DayCell unit={u} date={d} day={byKey.get(`${u.equipmentId}|${d}`)} onOpen={onOpen} />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {legend}
      <Container flush>
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Field log status by machine and day</caption>
          <colgroup>
            <col className="w-[28%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 text-left font-medium text-text-muted">
                Machine
              </th>
              {dates.map((d) => (
                <th key={d} scope="col" className="px-1 py-2 text-center font-medium text-text-muted">
                  {dayHead(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hub.units.map((u) => (
              <tr key={`${u.rentalId}-${u.equipmentId}`} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {unitName(u)}
                </th>
                {dates.map((d) => (
                  <td key={d} className="px-1 py-1 text-center">
                    <DayCell unit={u} date={d} day={byKey.get(`${u.equipmentId}|${d}`)} onOpen={onOpen} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
    </div>
  );
}

function Equipment({ hub, siteId }: { hub: SiteHubResponse; siteId: string }) {
  const columns: TableColumn<FieldLogUnit>[] = [
    {
      header: 'Machine',
      kind: 'text',
      width: '26%',
      cell: (u) => (
        <span className="flex flex-col">
          <Link
            to="/app/ocr"
            search={{ site: siteId, equipment: u.equipmentId }}
            className="font-medium text-accent hover:underline"
          >
            {u.name}
          </Link>
          <span className="font-mono text-xs text-text-muted">SN {u.serialNo}</span>
        </span>
      ),
    },
    {
      header: 'Booking',
      kind: 'text',
      width: '18%',
      cell: (u) => (
        <Link to="/app/bookings" search={{ open: u.bookingCode }} className="hover:underline">
          <BookingCode code={u.bookingCode} />
        </Link>
      ),
    },
    {
      header: 'On site',
      kind: 'date',
      width: '22%',
      cell: (u) => `${formatDate(u.span.from)} – ${u.span.to ? formatDate(u.span.to) : 'open'}`,
    },
    { header: 'Operator', kind: 'text', width: '16%', cell: (u) => u.operatorName ?? '--' },
    {
      header: 'Hour meter',
      kind: 'number',
      width: '18%',
      cell: (u) => (
        <>
          {u.lastMeterReading !== null ? u.lastMeterReading.toFixed(1) : '--'}
          <span className="block font-sans text-xs text-text-muted">{u.runtimeHours.toFixed(1)} h run total</span>
        </>
      ),
    },
  ];
  return (
    <Table
      header={{ title: 'Machines on this site', count: hub.units.length }}
      columns={columns}
      rows={hub.units}
      rowKey={(u) => `${u.rentalId}-${u.equipmentId}`}
      empty="No machines deployed here."
    />
  );
}

function Personnel({ hub, siteId }: { hub: SiteHubResponse; siteId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pick, setPick] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: sitesQueries.hub(siteId).queryKey });
  const nameOf = (userId: string) => hub.personnel.availableTimekeepers.find((t) => t.userId === userId)?.name ?? 'The timekeeper';
  const add = useMutation({
    mutationFn: (userId: string) => apiPost(`/sites/${siteId}/timekeepers`, { userId }),
    onSuccess: async (_res, userId) => {
      toast.success('Timekeeper assigned', `${nameOf(userId)} can now submit logs for this site.`);
      setPick('');
      setAssigning(false);
      await refresh();
    },
    onError: (err) => toast.error('Could not assign the timekeeper', apiErrorText(err)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiDelete(`/sites/${siteId}/timekeepers/${userId}`),
    onSuccess: async () => {
      toast.success('Timekeeper removed', `${removing?.name ?? 'They'} can no longer submit logs for this site.`);
      setRemoving(null);
      await refresh();
    },
    onError: (err) => toast.error('Could not remove the timekeeper', apiErrorText(err)),
  });
  const p = hub.personnel;
  const list = (items: string[], empty: string) =>
    items.length ? (
      <ul className="flex flex-col gap-1 text-sm text-text">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-text-muted">{empty}</p>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Container
        header={{
          title: 'Timekeepers',
          count: p.timekeepers.length,
          ...(p.availableTimekeepers.length > 0
            ? {
                actions: (
                  <Button variant="secondary" onClick={() => setAssigning(true)}>
                    Assign
                  </Button>
                ),
              }
            : {}),
        }}
      >
        {p.timekeepers.length === 0 && <p className="text-sm text-text-muted">None assigned: no one can submit logs here.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {p.timekeepers.map((t) => (
            <li key={t.userId} className="flex items-center justify-between gap-2">
              <span className="text-text">{t.name}</span>
              <Button variant="ghost" onClick={() => setRemoving({ userId: t.userId, name: t.name })} aria-label={`Remove ${t.name}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Modal
          open={assigning}
          onClose={() => setAssigning(false)}
          title="Assign a timekeeper"
          description="They can submit daily logs for the machines on this site."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAssigning(false)}>
                Cancel
              </Button>
              <Button disabled={!pick} loading={add.isPending} onClick={() => add.mutate(pick)}>
                Assign
              </Button>
            </>
          }
        >
          <Select id="add-timekeeper" label="Timekeeper" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose…</option>
            {p.availableTimekeepers.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.name}
              </option>
            ))}
          </Select>
        </Modal>
        <ConfirmDialog
          open={removing !== null}
          tone="danger"
          title="Remove this timekeeper?"
          body={
            <p>
              <strong>{removing?.name}</strong> can no longer submit logs for this site. Logs they already sent are kept.
            </p>
          }
          confirmLabel="Remove timekeeper"
          pending={remove.isPending}
          onConfirm={() => {
            if (removing) remove.mutate(removing.userId);
          }}
          onCancel={() => setRemoving(null)}
        />
      </Container>
      <Container header={{ title: 'Operators', count: p.operators.length }}>
        {list(
          p.operators.map((o) => `${o.name} · ${o.equipmentName}`),
          'No operator assigned to a machine here.',
        )}
      </Container>
      <Container header={{ title: 'Customer site reps', count: p.siteReps.length }}>
        {list(
          p.siteReps.map((r) => `${r.name} (${r.bookingCode})`),
          'The customer has not named a site rep.',
        )}
      </Container>
      <Container header={{ title: 'Truck drivers and helpers', count: p.truckCrew.length }}>
        {list(
          p.truckCrew.map(
            (c) =>
              `${c.code} · ${formatDate(c.scheduledFor)} · driver ${c.driverName ?? 'not named'} · helper ${c.helperName ?? 'not named'}`,
          ),
          'No truck trips to this site.',
        )}
      </Container>
    </div>
  );
}

function Documents({ hub }: { hub: SiteHubResponse }) {
  return (
    <Container header={{ title: 'Site documents', count: hub.documents.length }}>
      {hub.documents.length === 0 && <p className="text-sm text-text-muted">No documents uploaded for this site.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {hub.documents.map((d) => (
          <li key={d.id} className="flex flex-wrap justify-between gap-2">
            <span className="text-text">{formatStatus(d.documentType)}</span>
            <span className="inline-flex items-center gap-3 text-text-muted">
              <StatusBadge status={d.status} />
              {formatDate(d.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Container>
  );
}

function SiteHubPage() {
  const { siteId } = appSiteHubRoute.useParams();
  const { tab = 'overview' } = appSiteHubRoute.useSearch();
  const navigate = appSiteHubRoute.useNavigate();
  const hub = useQuery(sitesQueries.hub(siteId));
  const today = manilaDate(new Date());

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={hub.data ? hub.data.site.address || 'Project site' : 'Project site'}
        {...(hub.data?.site.customerName ? { description: hub.data.site.customerName } : {})}
        actions={
          <Link to="/app/deployment">
            <Button variant="ghost">All sites</Button>
          </Link>
        }
      />
      <Tabs
        label="Site sections"
        value={tab}
        onChange={(t) => void navigate({ search: { tab: t } })}
        items={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], badge: t === 'logs' ? (hub.data?.totals.pending ?? null) : null }))}
      />
      {hub.isError && <Alert type="error">{apiErrorText(hub.error)}</Alert>}
      {hub.isPending && <p className="text-sm text-text-muted">Loading the site...</p>}
      {hub.data && (
        <div role="tabpanel">
          {tab === 'overview' && <Overview hub={hub.data} today={today} />}
          {tab === 'logs' && <DailyLogs hub={hub.data} today={today} siteId={siteId} />}
          {tab === 'equipment' && <Equipment hub={hub.data} siteId={siteId} />}
          {tab === 'personnel' && <Personnel hub={hub.data} siteId={siteId} />}
          {tab === 'documents' && <Documents hub={hub.data} />}
        </div>
      )}
    </div>
  );
}

export const appSiteHubRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/deployment/$siteId',
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) ? { tab: search.tab as Tab } : {},
  component: SiteHubPage,
});
