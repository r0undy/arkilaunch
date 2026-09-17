import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { EdtrCaptureResponse, EdtrDetailResponse } from '@arkilaunch/shared';
import { apiGet, apiPost, apiPostForm } from '../lib/api-client.js';
import type { EquipmentRef, RentalRef } from '../lib/reference-client.js';
import { explainEdtrError } from '../lib/edtr-error.js';
import { formatDate, formatHours, formatStatus, shortCode } from '../lib/format.js';
import { Button } from './button.js';
import { CaptureField } from './capture-field.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { Modal } from './modal.js';
import { ConfidenceChip } from './confidence-chip.js';
import { useToast } from './toast.js';

// Lifted out of routes/edtr.tsx so the timekeeper console can open the same
// modal. Recording a field log is the timekeeper's whole job (PRD US-02,
// S21), and until this moved there was no route in the app that let that
// role do it: /app/ocr is guarded to admin/owner/platform_admin, so a
// timekeeper was redirected away from the only screen that could open this.
// The server was never the constraint -- POST /edtr requires `edtr:create`,
// which the timekeeper role has held all along.

// Statuses the capture poll stops on: past these, nothing more arrives
// without a human.
const TERMINAL_STATUSES = new Set(['review', 'reconciled', 'hard_failed']);

export interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
  rentals: RentalRef[];
  equipmentList: EquipmentRef[];
  rentalLabel: (rental: RentalRef) => string;
  onCaptured: () => void;
  toast: ReturnType<typeof useToast>;
}

export function CaptureModal({
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
                {formatHours(detail.lineItems[0].hoursActive)} working
                {/* A paper sheet has no idle column, so idle is genuinely
                    unrecorded rather than zero. Saying "0.0 idle" would
                    report a reading nobody took. */}
                {detail.lineItems[0].hoursIdle === null
                  ? '. Idle hours not recorded on this sheet.'
                  : `, ${formatHours(detail.lineItems[0].hoursIdle)} idle.`}
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
