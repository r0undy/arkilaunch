import { createRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiPost } from '../lib/api-client.js';

// POC scaffold only (unstyled): exercises POST /quotes/preview, POST
// /quotes, and POST /quotes/:id/approve (RFC-3). No form validation beyond
// the browser's `required`; the API's Zod schema is the real boundary.
function QuotesPage() {
  const [customerId, setCustomerId] = useState('');
  const [projectSiteId, setProjectSiteId] = useState('');
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [rateCardId, setRateCardId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [estimatedHours, setEstimatedHours] = useState('8');
  const [mobilizationKm, setMobilizationKm] = useState('0');
  const [demobilizationKm, setDemobilizationKm] = useState('0');

  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);

  function buildBody() {
    return {
      customerId,
      projectSiteId,
      discount: { type: 'none', value: 0 },
      items: [
        {
          equipmentTypeId,
          rateCardId,
          quantity: Number(quantity),
          estimatedHours: Number(estimatedHours),
          mobilizationKm: Number(mobilizationKm),
          demobilizationKm: Number(demobilizationKm),
        },
      ],
    };
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await apiPost('/quotes/preview', buildBody());
      setResult(res);
    } catch (err) {
      setError(err);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await apiPost<{ id: string }>('/quotes', buildBody());
      setResult(res);
      setQuoteId(res.id);
    } catch (err) {
      setError(err);
    }
  }

  async function approve() {
    if (!quoteId) return;
    setError(null);
    try {
      const res = await apiPost(`/quotes/${quoteId}/approve`, {});
      setResult(res);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <h1>Quotes (RFC-3)</h1>
      <form>
        <div>
          <label htmlFor="customerId">Customer ID</label>
          <input id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="projectSiteId">Project Site ID</label>
          <input id="projectSiteId" value={projectSiteId} onChange={(e) => setProjectSiteId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="equipmentTypeId">Equipment Type ID</label>
          <input id="equipmentTypeId" value={equipmentTypeId} onChange={(e) => setEquipmentTypeId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="rateCardId">Rate Card ID</label>
          <input id="rateCardId" value={rateCardId} onChange={(e) => setRateCardId(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="quantity">Quantity</label>
          <input id="quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label htmlFor="estimatedHours">Estimated hours</label>
          <input id="estimatedHours" type="number" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
        </div>
        <div>
          <label htmlFor="mobilizationKm">Mobilization km</label>
          <input id="mobilizationKm" type="number" value={mobilizationKm} onChange={(e) => setMobilizationKm(e.target.value)} />
        </div>
        <div>
          <label htmlFor="demobilizationKm">Demobilization km</label>
          <input id="demobilizationKm" type="number" value={demobilizationKm} onChange={(e) => setDemobilizationKm(e.target.value)} />
        </div>
        <button type="submit" onClick={preview}>
          Preview
        </button>
        <button type="submit" onClick={create}>
          Create draft
        </button>
        <button type="button" onClick={approve} disabled={!quoteId}>
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

export const quotesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/quotes',
  beforeLoad: () => {
    if (!getAccessToken()) throw redirect({ to: '/login' });
  },
  component: QuotesPage,
});
