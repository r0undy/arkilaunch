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
import { apiErrorText, apiGet, apiPatch, apiPost } from '../lib/api-client.js';

// The maintenance view of one machine: per-task schedules, logging a service
// (which resets that task's next_due), and a manual hour-meter correction.
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
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['equipment'] });

  const [preset, setPreset] = useState(MAINTENANCE_PRESETS[0]!.task);
  const [task, setTask] = useState(MAINTENANCE_PRESETS[0]!.task);
  const [interval, setHoursInterval] = useState(String(MAINTENANCE_PRESETS[0]!.hoursInterval));
  const [runtime, setRuntime] = useState('');
  const [reason, setReason] = useState('');

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
      toast.success('Hour meter corrected', 'The change and its reason are in the audit log.');
    },
    onError: (error) => toast.error('Could not correct the hour meter', apiErrorText(error)),
  });

  const data = detail.data;

  return (
    <Modal
      open
      onClose={onClose}
      title="Maintenance"
      description={`${equipment.model} (${equipment.serialNo})`}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <p className="text-sm text-text">
          Hour meter:{' '}
          <strong className="font-mono tabular-nums">{data ? data.runtimeHours : '…'} h</strong>
        </p>

        <section className="flex flex-col gap-3" aria-label="Schedules">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
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
                    <p className={warn ? 'text-error' : 'text-text-muted'}>
                      <span data-testid="hours-since">{s.hoursSinceService ?? '—'}</span> h since
                      service, every {s.hoursInterval} h
                      {s.nextDue !== null ? `, next due at ${s.nextDue} h` : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => logService.mutate(s.id)}
                    loading={logService.isPending && logService.variables === s.id}
                  >
                    Log service
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
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

        <section className="flex flex-col gap-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
            Correct hour meter
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Meter reading (hours)"
              type="number"
              step="0.01"
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
          <div>
            <Button
              variant="secondary"
              onClick={() => correct.mutate()}
              loading={correct.isPending}
              disabled={runtime.trim() === '' || !(Number(runtime) >= 0) || reason.trim().length < 3}
            >
              Save reading
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
