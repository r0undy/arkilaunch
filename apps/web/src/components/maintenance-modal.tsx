import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAINTENANCE_PRESETS,
  type EquipmentResponse,
  type MaintenanceDetailResponse,
} from '@arkilaunch/shared';
import { Modal } from './modal.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Button } from './button.js';
import { useToast } from './toast.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { Tabs } from './tabs.js';
import { EquipmentReport } from './equipment-report.js';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';
import { formatDateTime } from '../lib/format.js';

// One machine's report and maintenance: the report (hours, fuel, rentals,
// history) first, then per-task schedules, logging a service (which resets
// that task's next_due), blocked dates, and a manual hour-meter correction.

const DAY = 86_400_000;

// How long until a block ends, for the "ends soon" cue (null = not soon).
export function endsSoon(endsAt: string | Date, now = Date.now()): number | null {
  const left = new Date(endsAt).getTime() - now;
  return left > 0 && left <= 2 * DAY ? Math.ceil(left / DAY) : null;
}
export function MaintenanceModal({
  equipment,
  onClose,
}: {
  equipment: EquipmentResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['equipment', equipment.id, 'maintenance'] as const;
  const detail = useQuery({
    queryKey: key,
    queryFn: () => apiGet<MaintenanceDetailResponse>(`/equipment/${equipment.id}/maintenance`),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['equipment'] });
    void queryClient.invalidateQueries({ queryKey: ['maintenance-windows', 'ending-soon'] });
  };

  const [preset, setPreset] = useState(MAINTENANCE_PRESETS[0]!.task);
  const [task, setTask] = useState(MAINTENANCE_PRESETS[0]!.task);
  const [interval, setHoursInterval] = useState(String(MAINTENANCE_PRESETS[0]!.hoursInterval));
  const [runtime, setRuntime] = useState('');
  const [reason, setReason] = useState('');
  const [winStart, setWinStart] = useState('');
  const [winEnd, setWinEnd] = useState('');
  const [winNotes, setWinNotes] = useState('');
  const winInvalid = !winStart || !winEnd || new Date(winEnd) <= new Date(winStart);
  const [tab, setTab] = useState<'report' | 'schedules' | 'dates'>('report');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [unblocking, setUnblocking] = useState<{ id: string; span: string } | null>(null);
  const [correcting, setCorrecting] = useState(false);

  // A duplicate schedule, or a fresh plan: remove it. Past services stay.
  const removeSchedule = useMutation({
    mutationFn: (scheduleId: string) =>
      apiDelete(`/equipment/${equipment.id}/maintenance-schedules/${scheduleId}`),
    onSuccess: () => {
      refresh();
      setRemoving(null);
      toast.success('Schedule removed', 'Past service logs are kept.');
    },
    onError: (error) => toast.error('Could not remove that schedule', apiErrorText(error)),
  });

  // Push a block's end out by a day; it frees on its own after the end.
  const extendWindow = useMutation({
    mutationFn: ({ id, endsAt }: { id: string; endsAt: Date }) =>
      apiPatch(`/equipment/${equipment.id}/maintenance-windows/${id}`, {
        endsAt: endsAt.toISOString(),
      }),
    onSuccess: () => {
      refresh();
      toast.success('Block extended by a day');
    },
    onError: (error) => toast.error('Could not extend the block', apiErrorText(error)),
  });

  // Maintenance date windows: bookings cannot land on them.
  const addWindow = useMutation({
    mutationFn: () =>
      apiPost(`/equipment/${equipment.id}/maintenance-windows`, {
        startsAt: new Date(winStart).toISOString(),
        endsAt: new Date(winEnd).toISOString(),
        notes: winNotes.trim() || undefined,
      }),
    onSuccess: () => {
      refresh();
      setWinStart('');
      setWinEnd('');
      setWinNotes('');
      toast.success('Maintenance dates blocked', 'Bookings cannot use those dates.');
    },
    onError: (error) => toast.error('Could not block those dates', apiErrorText(error)),
  });
  const removeWindow = useMutation({
    mutationFn: (windowId: string) =>
      apiDelete(`/equipment/${equipment.id}/maintenance-windows/${windowId}`),
    onSuccess: () => {
      refresh();
      setUnblocking(null);
      toast.success('Dates unblocked', 'Bookings can use them again.');
    },
    onError: (error) => toast.error('Could not remove those dates', apiErrorText(error)),
  });

  const addSchedule = useMutation({
    mutationFn: () =>
      apiPost(`/equipment/${equipment.id}/maintenance-schedules`, {
        task: task.trim(),
        hoursInterval: Number(interval),
      }),
    onSuccess: () => {
      refresh();
      toast.success('Schedule added', `${task} every ${interval} h.`);
    },
    onError: (error) => toast.error('Could not add that schedule', apiErrorText(error)),
  });

  const logService = useMutation({
    mutationFn: (scheduleId: string) =>
      apiPost(`/equipment/${equipment.id}/maintenance-logs`, {
        performedAt: new Date().toISOString(),
        scheduleId,
      }),
    onSuccess: () => {
      refresh();
      toast.success('Service logged', 'Hours since service reset.');
    },
    onError: (error) => toast.error('Could not log that service', apiErrorText(error)),
  });

  const correct = useMutation({
    mutationFn: () =>
      apiPatch(`/equipment/${equipment.id}/runtime`, {
        runtimeHours: Number(runtime),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      refresh();
      setRuntime('');
      setReason('');
      setCorrecting(false);
      toast.success('Hour meter corrected', 'The change and its reason are in the audit log.');
    },
    onError: (error) => toast.error('Could not correct the hour meter', apiErrorText(error)),
  });

  const data = detail.data;

  return (
    <Modal
      open
      onClose={onClose}
      title={equipment.model}
      description={`Serial ${equipment.serialNo}`}
      size="lg"
    >
      <div className="mb-4">
        <Tabs
          label="Equipment"
          items={[
            { id: 'report', label: 'Report' },
            { id: 'schedules', label: 'Schedules', badge: data?.schedules.length ?? null },
            { id: 'dates', label: 'Blocked dates', badge: data?.windows.length ?? null },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'report' && <EquipmentReport equipmentId={equipment.id} />}
      {tab === 'schedules' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-sunk px-3 py-2">
            <p className="text-sm text-text">
              Hour meter:{' '}
              <strong className="font-mono tabular-nums">{data ? data.runtimeHours : '…'} h</strong>
            </p>
            <Button variant="ghost" onClick={() => setCorrecting(true)}>
              Correct hour meter
            </Button>
          </div>

          <section className="flex flex-col gap-3" aria-label="Schedules">
            <h3 className="text-sm font-medium text-text-muted">
              Schedules
            </h3>
            {data && data.schedules.length === 0 && (
              <p className="text-sm text-text-muted">No schedules yet.</p>
            )}
            <ul className="flex flex-col gap-2">
              {data?.schedules.map((s) => {
                const name = s.task ?? 'General service';
                const warn =
                  s.hoursSinceService !== null && s.hoursSinceService >= s.hoursInterval * 0.9;
                return (
                  <li
                    key={s.id}
                    aria-label={name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-3"
                  >
                    <div className="text-sm">
                      <p className="font-medium text-text">{name}</p>
                      <p className={warn ?'text-error' : 'text-text-muted'}>
                        <span data-testid="hours-since">{s.hoursSinceService ?? '—'}</span> h since
                        service, every {s.hoursInterval} h
                        {s.nextDue !== null ? `, next due at ${s.nextDue} h` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => logService.mutate(s.id)}
                        loading={logService.isPending && logService.variables === s.id}
                      >
                        Log service
                      </Button>
                      <Button variant="ghost" onClick={() => setRemoving({ id: s.id, name })}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-text-muted">
              Add schedule
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Preset"
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  const found = MAINTENANCE_PRESETS.find((p) => p.task === e.target.value);
                  if (found) {
                    setTask(found.task);
                    setHoursInterval(String(found.hoursInterval));
                  }
                }}
              >
                {MAINTENANCE_PRESETS.map((p) => (
                  <option key={p.task} value={p.task}>
                    {p.task} ({p.hoursInterval} h)
                  </option>
                ))}
                <option value="">Custom</option>
              </Select>
              <Input label="Task" value={task} onChange={(e) => setTask(e.target.value)} />
              <Input
                label="Interval (hours)"
                type="number"
                value={interval}
                onChange={(e) => setHoursInterval(e.target.value)}
              />
            </div>
            <div>
              <Button
                variant="primary"
                onClick={() => addSchedule.mutate()}
                loading={addSchedule.isPending}
                disabled={!task.trim() || !(Number(interval) > 0)}
              >
                Add schedule
              </Button>
            </div>
          </section>
        </div>
      )}
      {tab === 'dates' && (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3" aria-label="Maintenance dates">
            <h3 className="text-sm font-medium text-text-muted">
              Maintenance dates
            </h3>
            {data && data.windows.length === 0 && (
              <p className="text-sm text-text-muted">No dates blocked.</p>
            )}
            <ul className="flex flex-col gap-2">
              {data?.windows.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-3 text-sm text-text"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {formatDateTime(w.startsAt)} to {formatDateTime(w.endsAt)}
                    {w.notes ? ` · ${w.notes}` : ''}
                    {new Date(w.endsAt).getTime() <= Date.now() ? (
                      <span className="text-xs text-text-muted">ended · unit is free again</span>
                    ) : (
                      endsSoon(w.endsAt) !== null && (
                        <span className="rounded-full border border-warning px-2 text-xs text-text">
                          ends in {endsSoon(w.endsAt)} day(s)
                        </span>
                      )
                    )}
                  </span>
                  <span className="flex gap-2">
                    {new Date(w.endsAt).getTime() > Date.now() && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          extendWindow.mutate({
                            id: w.id,
                            endsAt: new Date(new Date(w.endsAt).getTime() + DAY),
                          })
                        }
                        loading={extendWindow.isPending && extendWindow.variables?.id === w.id}
                      >
                        +1 day
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setUnblocking({
                          id: w.id,
                          span: `${formatDateTime(w.startsAt)} to ${formatDateTime(w.endsAt)}`,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="From"
                type="datetime-local"
                value={winStart}
                onChange={(e) => setWinStart(e.target.value)}
              />
              <Input
                label="Until"
                type="datetime-local"
                value={winEnd}
                onChange={(e) => setWinEnd(e.target.value)}
              />
              <Input
                label="Note (optional)"
                value={winNotes}
                onChange={(e) => setWinNotes(e.target.value)}
              />
            </div>
            <div>
              <Button
                variant="secondary"
                onClick={() => addWindow.mutate()}
                loading={addWindow.isPending}
                disabled={winInvalid}
              >
                Block dates
              </Button>
            </div>
          </section>
        </div>
      )}
      <Modal
        open={correcting}
        onClose={() => setCorrecting(false)}
        title="Correct hour meter"
        description="For a replaced or misread meter. The change and its reason go in the audit log."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrecting(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => correct.mutate()}
              loading={correct.isPending}
              disabled={
                runtime.trim() === '' || !(Number(runtime) >= 0) || reason.trim().length < 3
              }
            >
              Save reading
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Meter reading (hours)"
            type="number"
            step="0.01"
            numeric
            value={runtime}
            onChange={(e) => setRuntime(e.target.value)}
          />
          <Input
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Meter replaced"
          />
        </div>
      </Modal>
      <ConfirmDialog
        open={unblocking !== null}
        title="Unblock these dates?"
        tone="danger"
        confirmLabel="Unblock dates"
        pending={removeWindow.isPending}
        body={
          <p>
            Bookings can land on <strong>{unblocking?.span}</strong> again.
          </p>
        }
        onConfirm={() => {
          if (unblocking) removeWindow.mutate(unblocking.id);
        }}
        onCancel={() => setUnblocking(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this schedule?"
        tone="danger"
        confirmLabel="Remove it"
        pending={removeSchedule.isPending}
        body={
          <p>
            <strong>{removing?.name}</strong> stops counting hours. Past service logs are kept. Add
            a new schedule to start a fresh plan.
          </p>
        }
        onConfirm={() => {
          if (removing) removeSchedule.mutate(removing.id);
        }}
        onCancel={() => setRemoving(null)}
      />
    </Modal>
  );
}
