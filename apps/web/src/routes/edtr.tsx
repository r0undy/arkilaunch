import { createRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiGet, apiPost } from '../lib/api-client.js';
import { readFileAsDataUrl } from '../lib/file-utils.js';
import { getEquipment, getRentals, type EquipmentRef, type RentalRef } from '../lib/reference-client.js';

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
    <div>
      <h1>EDTR (RFC-2)</h1>
      {refError != null && <p>Could not load rentals/equipment -- is the API running? See error below.</p>}
      <form onSubmit={capture}>
        <h2>Capture</h2>
        <div>
          <label>
            <input
              type="radio"
              name="source"
              value="digital_entry"
              checked={source === 'digital_entry'}
              onChange={() => setSource('digital_entry')}
            />
            Digital entry (type in hours)
          </label>
          <label>
            <input
              type="radio"
              name="source"
              value="paper_ocr"
              checked={source === 'paper_ocr'}
              onChange={() => setSource('paper_ocr')}
            />
            Scan paper EDTR (camera / file upload)
          </label>
        </div>

        <div>
          <label htmlFor="rentalId">Rental</label>
          <select id="rentalId" value={rentalId} onChange={(e) => setRentalId(e.target.value)} required>
            {rentals.length === 0 && <option value="">(no rentals seeded for this tenant)</option>}
            {rentals.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id.slice(0, 8)} ({r.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="equipmentId">Equipment</label>
          <select id="equipmentId" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} required>
            {equipmentList.length === 0 && <option value="">(no equipment seeded for this tenant)</option>}
            {equipmentList.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.model} ({eq.serialNo})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reportDate">Report date</label>
          <input id="reportDate" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} required />
        </div>

        {source === 'digital_entry' ? (
          <>
            <div>
              <label htmlFor="hoursActive">Hours active</label>
              <input id="hoursActive" type="number" value={hoursActive} onChange={(e) => setHoursActive(e.target.value)} />
            </div>
            <div>
              <label htmlFor="hoursIdle">Hours idle</label>
              <input id="hoursIdle" type="number" value={hoursIdle} onChange={(e) => setHoursIdle(e.target.value)} />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="scanFile">Scan / upload the EDTR sheet</label>
            <input id="scanFile" type="file" accept="image/*" capture="environment" onChange={onScanFile} />
            {scanning && <p>Reading file…</p>}
            {scanPreview && (
              <div>
                <p>Preview:</p>
                <img src={scanPreview} alt="Scanned EDTR preview" width={240} />
              </div>
            )}
            <p>
              Extraction runs asynchronously by the edtr-ocr-worker job (RFC-2); after capture the record sits at
              &quot;queued&quot; until that job runs -- use &quot;Run extraction (dev)&quot; below to trigger it for
              this demo.
            </p>
          </div>
        )}

        <button type="submit" disabled={!rentalId || !equipmentId || (source === 'paper_ocr' && !scanDataUrl)}>
          Capture EDTR
        </button>
      </form>

      <button type="button" onClick={poll} disabled={!edtrId}>
        Poll status
      </button>
      {source === 'paper_ocr' && (
        <button type="button" onClick={runWorkerAndPoll} disabled={!edtrId}>
          Run extraction (dev)
        </button>
      )}

      <form onSubmit={approve}>
        <h2>Approve / deduct</h2>
        <div>
          <label htmlFor="reconciliationId">Reconciliation ID</label>
          <input
            id="reconciliationId"
            value={reconciliationId}
            onChange={(e) => setReconciliationId(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="adjActive">Adjustment: hours active (optional)</label>
          <input id="adjActive" type="number" value={adjActive} onChange={(e) => setAdjActive(e.target.value)} />
        </div>
        <div>
          <label htmlFor="adjIdle">Adjustment: hours idle (optional)</label>
          <input id="adjIdle" type="number" value={adjIdle} onChange={(e) => setAdjIdle(e.target.value)} />
        </div>
        <button type="submit" disabled={!edtrId}>
          Approve
        </button>
      </form>

      {error != null && (
        <div>
          <h2>Error</h2>
          <pre>{JSON.stringify(error, null, 2)}</pre>
        </div>
      )}
      {result != null && (
        <div>
          <h2>Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export const edtrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/edtr',
  beforeLoad: () => {
    if (!getAccessToken()) throw redirect({ to: '/login' });
  },
  component: EdtrPage,
});
