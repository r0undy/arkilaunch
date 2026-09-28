import { createRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
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
import { Surface } from '../components/surface.js';
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

const heading = 'text-heading-md text-text';

const STATUS_META: Record<FieldLogDayStatus, { label: string; className: string }> = {
  missing: { label: 'Missing', className: 'border border-dashed border-border text-text-muted' },
  pending: { label: 'Pending', className: 'bg-recon-review text-text' },
  needs_correction: { label: 'Needs correction', className: 'bg-recon-discrepancy text-white' },
  approved: { label: 'Approved', className: 'bg-recon-approved text-white' },
  rejected: { label: 'Rejected', className: 'bg-recon-failed text-white' },
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
  return (
    <div className="flex flex-col gap-4">
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5 text-sm">
        <h2 className={heading}>Site</h2>
        <p className="text-text">{hub.site.address || '--'}</p>
        <p className="text-text-muted">Customer: {hub.site.customerName ?? '--'}</p>
        <a
          className="w-fit text-accent underline"
          href={`https://www.openstreetmap.org/?mlat=${hub.site.latitude}&mlon=${hub.site.longitude}#map=17/${hub.site.latitude}/${hub.site.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Map pin ({hub.site.latitude.toFixed(5)}, {hub.site.longitude.toFixed(5)})
        </a>
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
        <h2 className={heading}>Bookings on this site</h2>
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
                <span className="text-sm text-text-muted">{formatStatus(r.status)}</span>
              </div>
              <p className="text-sm text-text">
                {r.customerName ?? '--'} · Site rep {r.siteRep ?? 'not given'}
              </p>
              <p className="text-sm text-text-muted">
                {formatDate(r.start)} – {r.end ? formatDate(r.end) : 'open'}
                {r.extended && <span className="ml-2 font-semibold text-accent">Extended</span>}
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
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
        <h2 className={heading}>Approved field logs</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Running" value={`${t.running.toFixed(1)} h`} />
          <Stat label="Billable idle" value={`${t.idle.toFixed(1)} h`} />
          <Stat label="Downtime" value={`${(t.breakdown + t.weather + t.otherDowntime).toFixed(1)} h`} />
          <Stat label="Billed to date" value={formatPeso(t.billedPhp)} />
        </div>
        <p className="text-sm text-text-muted">
          {t.daysApproved} of {t.daysInSpan} unit-days approved · {t.pending} pending
        </p>
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
        <h2 className={heading}>Weather now</h2>
        <SiteEquipmentWeather siteId={hub.site.id} />
      </Surface>
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
      description={day ? `${STATUS_META[day.status].label}${unit ? ` · ${unit.bookingCode} · SN ${unit.serialNo}` : ''}` : ''}
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
      {detail.isError && <p className="text-sm text-error">{apiErrorText(detail.error)}</p>}
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
            <ul className="flex flex-col gap-1 rounded-md border border-warning p-3 text-sm text-text">
              {day.flags.map((f) => (
                <li key={f}>! {REVIEW_FLAGS[f as ReviewFlag] ?? f}</li>
              ))}
            </ul>
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
        <Surface radius="md" elevation="sm" className="flex flex-col gap-2 border-warning p-4">
          <p className="text-sm font-semibold text-text">
            {lost} full day{lost === 1 ? '' : 's'} lost to breakdown or weather. Extend the rental?
          </p>
          <div className="flex flex-wrap gap-2">
            {hub.rentals
              .filter((r) => r.status === 'active')
              .map((r) => (
                <Link key={r.id} to="/app/bookings/$bookingId" params={{ bookingId: r.id }}>
                  <Button variant="secondary">Extend {r.code}</Button>
                </Link>
              ))}
          </div>
        </Surface>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Field log status by machine and day</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-left font-semibold text-text-muted">
                  Machine
                </th>
                {dates.map((d) => (
                  <th key={d} scope="col" className="p-2 text-center font-semibold text-text-muted">
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'UTC' })}
                    <br />
                    <span className="font-mono text-xs">{d.slice(5)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hub.units.map((u) => (
                <tr key={`${u.rentalId}-${u.equipmentId}`} className="border-t border-border">
                  <th scope="row" className="p-2 text-left font-normal">
                    <span className="block font-medium text-text">{u.name}</span>
                    <span className="font-mono text-xs text-text-muted">
                      {u.bookingCode} · SN {u.serialNo}
                    </span>
                  </th>
                  {dates.map((d) => {
                    const day = byKey.get(`${u.equipmentId}|${d}`);
                    if (!inSpan(u, d)) {
                      return (
                        <td key={d} className="p-1 text-center">
                          <span className="block rounded-sm bg-border/40 px-1 py-2 text-xs text-text-muted" title="Outside the rental">
                            —
                          </span>
                        </td>
                      );
                    }
                    if (!day) {
                      return (
                        <td key={d} className="p-1 text-center text-xs text-text-muted">
                          Upcoming
                        </td>
                      );
                    }
                    const meta = STATUS_META[day.status];
                    return (
                      <td key={d} className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => setOpen(day)}
                          className={`block w-full rounded-sm px-1 py-2 text-xs font-semibold ${meta.className}`}
                          aria-label={`${u.name} ${d}: ${meta.label}${day.flags.length ? ', flagged' : ''}`}
                        >
                          {meta.label}
                          {day.flags.length > 0 && ' !'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        toast={toast}
        initialSource="paper_ocr"
        {...(recordRental ? { initialRentalId: recordRental } : {})}
      />
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
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">
        {hub.units.length} machine{hub.units.length === 1 ? '' : 's'} at this site. Click a machine for its field logs,
        or a booking code to open the booking.
      </p>
      <Table
        columns={columns}
        rows={hub.units}
        rowKey={(u) => `${u.rentalId}-${u.equipmentId}`}
        empty="No machines deployed here."
      />
    </div>
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
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className={heading}>Timekeepers</h2>
          {p.availableTimekeepers.length > 0 && (
            <Button variant="secondary" onClick={() => setAssigning(true)}>
              Assign
            </Button>
          )}
        </div>
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
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
        <h2 className={heading}>Operators</h2>
        {list(
          p.operators.map((o) => `${o.name} · ${o.equipmentName}`),
          'No operator assigned to a machine here.',
        )}
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
        <h2 className={heading}>Customer site reps</h2>
        {list(
          p.siteReps.map((r) => `${r.name} (${r.bookingCode})`),
          'The customer has not named a site rep.',
        )}
      </Surface>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
        <h2 className={heading}>Truck drivers and helpers</h2>
        {list(
          p.truckCrew.map(
            (c) =>
              `${c.code} · ${formatDate(c.scheduledFor)} · driver ${c.driverName ?? 'not named'} · helper ${c.helperName ?? 'not named'}`,
          ),
          'No truck trips to this site.',
        )}
      </Surface>
    </div>
  );
}

function Documents({ hub }: { hub: SiteHubResponse }) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-5">
      <h2 className={heading}>Site documents</h2>
      {hub.documents.length === 0 && <p className="text-sm text-text-muted">No documents uploaded for this site.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {hub.documents.map((d) => (
          <li key={d.id} className="flex flex-wrap justify-between gap-2">
            <span className="text-text">{formatStatus(d.documentType)}</span>
            <span className="text-text-muted">
              {formatStatus(d.status)} · {formatDate(d.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Surface>
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
      {hub.isError && <p className="text-sm text-error">{apiErrorText(hub.error)}</p>}
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
