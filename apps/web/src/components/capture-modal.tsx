import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EdtrCaptureResponse, EdtrDetailResponse } from '@arkilaunch/shared';
import { apiGet, apiPost, apiPostForm } from '../lib/api-client.js';
import type { EquipmentRef, RentalRef } from '../lib/reference-client.js';
import { explainEdtrError } from '../lib/edtr-error.js';
import { formatDate, formatHours, formatStatus, shortCode } from '../lib/format.js';
import { manilaDate } from '@arkilaunch/shared';
import { EMPTY_HOURS, HourFields, toLineItems, type HourFieldValues } from './hour-fields.js';
import { Button } from './button.js';
import { CaptureField } from './capture-field.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { Modal } from './modal.js';
import { ScanReview } from './scan-review.js';
import { referenceQueries } from '../lib/queries.js';
import { useToast } from './toast.js';

const TERMINAL_STATUSES = new Set(['review', 'reconciled', 'hard_failed']);

const SCANNING_TIPS = [
  {
    title: 'Good light',
    detail: 'Light the sheet evenly and keep overhead glare off the glossy parts.',
  },
  { title: 'Flat and square', detail: 'Lay the sheet flat and fit its edges inside the frame.' },
  { title: 'Hold still', detail: 'A steady shot is what keeps the handwritten totals readable.' },
];

export interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
  rentals: RentalRef[];
  equipmentList: EquipmentRef[];
  rentalLabel: (rental: RentalRef) => string;
  onCaptured: () => void;
  initialRentalId?: string;
  initialSource?: 'digital_entry' | 'paper_ocr';
  submitOnly?: boolean;
}

export function CaptureModal({
  open,
  onClose,
  rentals,
  equipmentList,
  rentalLabel,
  onCaptured,
  initialRentalId,
  initialSource = 'digital_entry',
  submitOnly = false,
}: CaptureModalProps) {
  const toast = useToast();
  const [source, setSource] = useState<'digital_entry' | 'paper_ocr'>(initialSource);
  const [rentalId, setRentalId] = useState(initialRentalId ?? '');
  const [equipmentId, setEquipmentId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [hours, setHours] = useState<HourFieldValues>({ ...EMPTY_HOURS, running: '8' });
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // With the OCR pipeline on, a paper scan must not carry typed hours (422 line_items_not_accepted).
  const capabilities = useQuery(referenceQueries.capabilities());
  const ocrPipeline = capabilities.data?.ocrPipeline ?? false;

  const [pollUrl, setPollUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<EdtrDetailResponse | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialRentalId) setRentalId(initialRentalId);
  }, [initialRentalId]);

  useEffect(() => {
    setSource(initialSource);
  }, [initialSource]);

  useEffect(() => {
    if (rentals[0] && !rentalId) setRentalId(rentals[0].id);
  }, [rentals, rentalId]);

  const capturedRef = useRef(onCaptured);
  capturedRef.current = onCaptured;

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
          capturedRef.current();
        }
      } catch (err) {
        setError(err);
        stopPolling();
      }
    }
    void tick();
    pollTimer.current = setInterval(tick, 3000);
    return stopPolling;
  }, [pollUrl]);

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
    // Enter in the date field still submits the form after the button is disabled.
    if (pollUrl) return;
    setError(null);
    setSubmitting(true);
    try {
      let res: EdtrCaptureResponse;
      const lineItems = toLineItems(hours);
      if (!lineItems && !(source === 'paper_ocr' && ocrPipeline)) {
        throw new Error('Enter the running hours, and only numbers of zero or more.');
      }
      if (source === 'digital_entry') {
        res = await apiPost<EdtrCaptureResponse>('/edtr', {
          source: 'digital_entry',
          rentalId,
          equipmentId,
          reportDate,
          lineItems,
        });
      } else {
        // Multipart carries strings only: hours travel JSON-encoded.
        const transcribed = !ocrPipeline && lineItems ? { lineItems: JSON.stringify(lineItems) } : {};
        res = await apiPostForm<EdtrCaptureResponse>(
          '/edtr',
          { source: 'paper_ocr', rentalId, equipmentId, reportDate, ...transcribed },
          scanFile ?? undefined,
        );
      }
      if (submitOnly) {
        toast.success('Sent to the office', `${formatDate(reportDate)} is pending approval.`);
        onCaptured();
        handleClose();
        return;
      }
      // res.pollUrl carries the /api/v1 prefix apiGet adds itself.
      setPollUrl(`/edtr/${res.id}`);
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

  const equipment = equipmentList.find((eq) => eq.id === equipmentId);
  const equipmentLabel = equipment ? `${equipment.model} (${equipment.serialNo})` : 'Not set';
  const rental = rentals.find((r) => r.id === rentalId);
  const rentalSessionLabel = rental ? rentalLabel(rental) : 'Not set';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Record a field log"
      description="One day, one machine. Record it twice from two sources and the hours are matched before billing."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            {pollUrl ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={capture}
            loading={submitting}
            disabled={!reportDate || !equipmentId || pollUrl !== null}
          >
            Record log
          </Button>
        </>
      }
    >
      <form onSubmit={capture} className="flex flex-col gap-4">
        <fieldset className={submitOnly ?'hidden' : 'flex flex-col gap-2'}>
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
              {r.code} · {rentalLabel(r)}
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
          <option value="">
            {equipmentList.length === 0 ? 'No machines available' : 'Choose the machine'}
          </option>
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
          {...(rental?.startDate ? { min: manilaDate(rental.startDate) } : {})}
          {...(rental?.endDate ? { max: manilaDate(rental.endDate) } : {})}
          hint={
            rental?.startDate
              ? `Within the rental: ${formatDate(rental.startDate)} to ${rental.endDate ? formatDate(rental.endDate) : 'open'}`
              : undefined
          }
        />

        {source === 'paper_ocr' && (
          <CaptureField
            id="scanFile"
            label="Photo of the sheet"
            accept="image/*"
            size="field"
            value={scanFile}
            onChange={setScanFile}
            tips={SCANNING_TIPS}
            sessionData={[
              { label: 'Machine', value: equipmentLabel },
              { label: 'Rental', value: rentalSessionLabel },
              { label: 'Day worked', value: reportDate ? formatDate(reportDate) : 'Not set' },
            ]}
          />
        )}

        {!(source === 'paper_ocr' && ocrPipeline) && <HourFields value={hours} onChange={setHours} idPrefix="capture" />}
        {source === 'paper_ocr' && !ocrPipeline && (
          <p className="-mt-2 text-sm text-text-muted">
            Type the hours exactly as written on the sheet. The photo is kept either way, so the
            original can always be checked against what was billed.
          </p>
        )}
        {source === 'paper_ocr' && ocrPipeline && (
          <p className="-mt-2 text-sm text-text-muted">
            The hours are read off the sheet itself, so there is nothing to type here. Anything read
            below 90% certainty comes back for a person to check.
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
                {detail.lineItems[0].hoursIdle === null
                  ? '. Idle hours not recorded on this sheet.'
                  : `, ${formatHours(detail.lineItems[0].hoursIdle)} idle.`}
              </p>
            )}
            {detail.fields.length > 0 && <ScanReview detail={detail} />}
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
