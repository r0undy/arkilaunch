import { createRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiGet, apiPost } from '../lib/api-client.js';

// POC scaffold only (unstyled): exercises POST /edtr (digital_entry only --
// paper_ocr multipart upload is a follow-up), GET /edtr/:id, and POST
// /edtr/:id/approve (RFC-2).
function EdtrPage() {
  const [rentalId, setRentalId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [hoursActive, setHoursActive] = useState('8');
  const [hoursIdle, setHoursIdle] = useState('0');

  const [reconciliationId, setReconciliationId] = useState('');
  const [adjActive, setAdjActive] = useState('');
  const [adjIdle, setAdjIdle] = useState('');

  const [edtrId, setEdtrId] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  async function capture(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await apiPost<{ id: string }>('/edtr', {
        source: 'digital_entry',
        rentalId,
        equipmentId,
        reportDate,
        lineItems: { hoursActive: Number(hoursActive), hoursIdle: Number(hoursIdle) },
      });
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
      <form onSubmit={capture}>
        <h2>Capture (digital entry)</h2>
        <div>
          <label htmlFor="rentalId">Rental ID</label>
          <input id="rentalId" value={rentalId} onChange={(e) => setRentalId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="equipmentId">Equipment ID</label>
          <input id="equipmentId" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="reportDate">Report date</label>
          <input id="reportDate" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="hoursActive">Hours active</label>
          <input id="hoursActive" type="number" value={hoursActive} onChange={(e) => setHoursActive(e.target.value)} />
        </div>
        <div>
          <label htmlFor="hoursIdle">Hours idle</label>
          <input id="hoursIdle" type="number" value={hoursIdle} onChange={(e) => setHoursIdle(e.target.value)} />
        </div>
        <button type="submit">Capture EDTR</button>
      </form>

      <button type="button" onClick={poll} disabled={!edtrId}>
        Poll status
      </button>

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
