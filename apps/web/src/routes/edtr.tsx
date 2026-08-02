import { createRoute } from '@tanstack/react-router';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { appLayoutRoute } from './_app.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { readFileAsDataUrl } from '../lib/file-utils.js';
import { getEquipment, getRentals, type EquipmentRef, type RentalRef } from '../lib/reference-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';

// POC scaffold only (unstyled): exercises POST /edtr (both digital_entry
// and paper_ocr -- paper_ocr scans a real photo via <input capture>, encoded
// as a data: URL since no Supabase Storage upload exists yet), GET
// /edtr/:id, and POST /edtr/:id/approve (RFC-2). Rental/equipment come from
// GET /reference/* dropdowns rather than a hand-typed UUID.
function EdtrPage() {
  const [rentals, setRentals] = useState<RentalRef[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentRef[]>([]);
  const [refError, setRefError] = useState<unknown>(null);

  const [source, setSource] = useState<'digital_entry' | 'paper_ocr'>('digital_entry');
  const [rentalId, setRentalId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [hoursActive, setHoursActive] = useState('8');
  const [hoursIdle, setHoursIdle] = useState('0');

  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanDataUrl, setScanDataUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const [reconciliationId, setReconciliationId] = useState('');
  const [adjActive, setAdjActive] = useState('');
  const [adjIdle, setAdjIdle] = useState('');

  const [edtrId, setEdtrId] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([getRentals(), getEquipment()])
      .then(([r, e]) => {
        setRentals(r);
        setEquipmentList(e);
        if (r[0]) setRentalId(r[0].id);
        if (e[0]) setEquipmentId(e[0].id);
      })
      .catch(setRefError);
  }, []);

  async function onScanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setScanDataUrl(dataUrl);
      setScanPreview(dataUrl);
    } catch (err) {
      setError(err);
    } finally {
      setScanning(false);
    }
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const body =
        source === 'digital_entry'
          ? {
              source: 'digital_entry' as const,
              rentalId,
              equipmentId,
              reportDate,
              lineItems: { hoursActive: Number(hoursActive), hoursIdle: Number(hoursIdle) },
            }
          : {
              source: 'paper_ocr' as const,
              rentalId,
              equipmentId,
              reportDate,
              rawFileUri: scanDataUrl ?? '',
            };
      const res = await apiPost<{ id: string; status: string }>('/edtr', body);
      setResult(res);
      setEdtrId(res.id);
    } catch (err) {
      setError(err);
    }
  }

  async function poll() {
    if (!edtrId) return;
    setError(null);
    try {
      const res = await apiGet<{ reconciliation?: { id: string } | null }>(`/edtr/${edtrId}`);
      setResult(res);
      if (res.reconciliation?.id) setReconciliationId(res.reconciliation.id);
    } catch (err) {
      setError(err);
    }
  }

  async function runWorkerAndPoll() {
    setError(null);
    try {
      await apiPost('/edtr/dev/run-worker', {});
      await poll();
    } catch (err) {
      setError(err);
    }
  }

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (!edtrId) return;
    setError(null);
    try {
      const adjustments =
        adjActive !== '' && adjIdle !== ''
          ? { hoursActive: Number(adjActive), hoursIdle: Number(adjIdle) }
          : null;
      const res = await apiPost(`/edtr/${edtrId}/approve`, { reconciliationId, adjustments });
      setResult(res);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="min-h-screen bg-bg p-6">
      <h1 className="mb-6 font-display text-[28px] font-semibold leading-[1.15] text-text sm:text-[34px]">
        EDTR (RFC-2)
      </h1>
      {refError != null && (
        <p className="mb-4 text-error">Could not load rentals/equipment -- is the API running? See error below.</p>
      )}
      <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl p-6">
        <form onSubmit={capture} className="flex flex-col gap-4">
          <h2 className="font-display text-[22px] font-semibold leading-[1.2] text-text sm:text-[26px]">Capture</h2>
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
              Digital entry (type in hours)
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
              Scan paper EDTR (camera / file upload)
            </label>
          </div>

          <Select id="rentalId" label="Rental" value={rentalId} onChange={(e) => setRentalId(e.target.value)} required>
            {rentals.length === 0 && <option value="">(no rentals seeded for this tenant)</option>}
            {rentals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id.slice(0, 8)} ({r.status})
              </option>
            ))}
          </Select>
          <Select
            id="equipmentId"
            label="Equipment"
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            required
          >
            {equipmentList.length === 0 && <option value="">(no equipment seeded for this tenant)</option>}
            {equipmentList.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.model} ({eq.serialNo})
              </option>
            ))}
          </Select>
          <Input
            id="reportDate"
            label="Report date"
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            required
          />

          {source === 'digital_entry' ? (
            <>
              <Input
                numeric
                id="hoursActive"
                label="Hours active"
                type="number"
                value={hoursActive}
                onChange={(e) => setHoursActive(e.target.value)}
              />
              <Input
                numeric
                id="hoursIdle"
                label="Hours idle"
                type="number"
                value={hoursIdle}
                onChange={(e) => setHoursIdle(e.target.value)}
              />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="scanFile" className="text-sm font-medium text-text">
                Scan / upload the EDTR sheet
              </label>
              <input
                id="scanFile"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onScanFile}
                className="text-sm text-text-muted file:mr-3 file:min-h-11 file:rounded-sm file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-text"
              />
              {scanning && <p className="text-sm text-text-muted">Reading file…</p>}
              {scanPreview && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-text-muted">Preview:</p>
                  <img
                    src={scanPreview}
                    alt="Scanned EDTR preview"
                    width={240}
                    className="rounded-md border border-border"
                  />
                </div>
              )}
              <p className="text-sm text-text-muted">
                Extraction runs asynchronously by the edtr-ocr-worker job (RFC-2); after capture the record sits at
                &quot;queued&quot; until that job runs -- use &quot;Run extraction (dev)&quot; below to trigger it for
                this demo.
              </p>
            </div>
          )}

          <div>
            <Button type="submit" disabled={!rentalId || !equipmentId || (source === 'paper_ocr' && !scanDataUrl)}>
              Capture EDTR
            </Button>
          </div>
        </form>
      </Surface>

      <div className="mb-6 flex max-w-2xl flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={poll} disabled={!edtrId}>
          Poll status
        </Button>
        {source === 'paper_ocr' && (
          <Button type="button" variant="secondary" onClick={runWorkerAndPoll} disabled={!edtrId}>
            Run extraction (dev)
          </Button>
        )}
      </div>

      <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl p-6">
        <form onSubmit={approve} className="flex flex-col gap-4">
          <h2 className="font-display text-[22px] font-semibold leading-[1.2] text-text sm:text-[26px]">
            Approve / deduct
          </h2>
          <Input
            id="reconciliationId"
            label="Reconciliation ID"
            value={reconciliationId}
            onChange={(e) => setReconciliationId(e.target.value)}
            required
          />
          <Input
            numeric
            id="adjActive"
            label="Adjustment: hours active (optional)"
            type="number"
            value={adjActive}
            onChange={(e) => setAdjActive(e.target.value)}
          />
          <Input
            numeric
            id="adjIdle"
            label="Adjustment: hours idle (optional)"
            type="number"
            value={adjIdle}
            onChange={(e) => setAdjIdle(e.target.value)}
          />
          <div>
            <Button type="submit" variant="approve" disabled={!edtrId}>
              Approve
            </Button>
          </div>
        </form>
      </Surface>

      {error != null && (
        <Surface radius="md" elevation="sm" className="mb-6 max-w-2xl border-error p-4">
          <h2 className="mb-2 font-display text-[18px] font-semibold text-error">Error</h2>
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(error, null, 2)}</pre>
        </Surface>
      )}
      {result != null && (
        <Surface radius="md" elevation="sm" className="max-w-2xl p-4">
          <h2 className="mb-2 font-display text-[18px] font-semibold text-text">Result</h2>
          <pre className="overflow-x-auto font-mono text-sm text-text">{JSON.stringify(result, null, 2)}</pre>
        </Surface>
      )}
    </div>
  );
}

// Route path is /app/ocr (the Figma "OCR Tool" screen); the file/component
// name stays edtr for continuity with RFC-2 and the existing test/docs trail.
export const edtrRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/ocr',
  component: EdtrPage,
});
