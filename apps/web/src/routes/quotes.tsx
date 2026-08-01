import { createRoute, redirect } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { getAccessToken } from '../lib/auth-client.js';
import { apiPost } from '../lib/api-client.js';
import {
  getCustomers,
  getEquipmentTypes,
  getProjectSites,
  getRateCards,
  type CustomerRef,
  type EquipmentTypeRef,
  type ProjectSiteRef,
  type RateCardRef,
} from '../lib/reference-client.js';

// POC scaffold only (unstyled): exercises POST /quotes/preview, POST
// /quotes, and POST /quotes/:id/approve (RFC-3). Dropdowns are populated
// from GET /reference/* so you don't have to hand-type UUIDs.
function QuotesPage() {
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentTypeRef[]>([]);
  const [rateCards, setRateCards] = useState<RateCardRef[]>([]);
  const [projectSites, setProjectSites] = useState<ProjectSiteRef[]>([]);
  const [refError, setRefError] = useState<unknown>(null);

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

  useEffect(() => {
    Promise.all([getCustomers(), getEquipmentTypes(), getRateCards(), getProjectSites()])
      .then(([c, et, rc, ps]) => {
        setCustomers(c);
        setEquipmentTypes(et);
        setRateCards(rc);
        setProjectSites(ps);
        if (c[0]) setCustomerId(c[0].id);
        if (et[0]) setEquipmentTypeId(et[0].id);
        if (rc[0]) setRateCardId(rc[0].id);
        if (ps[0]) setProjectSiteId(ps[0].id);
      })
      .catch(setRefError);
  }, []);

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
      {refError != null && (
        <p>
          Could not load reference data (customers/equipment/rate cards/sites) -- is the API running? See error
          below.
        </p>
      )}
      <form>
        <div>
          <label htmlFor="customerId">Customer</label>
          <select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.length === 0 && <option value="">(no customers seeded for this tenant)</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="projectSiteId">Project site</label>
          <select id="projectSiteId" value={projectSiteId} onChange={(e) => setProjectSiteId(e.target.value)} required>
            {projectSites.length === 0 && <option value="">(no sites seeded for this tenant)</option>}
            {projectSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.slice(0, 8)} ({s.latitude}, {s.longitude})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="equipmentTypeId">Equipment type</label>
          <select
            id="equipmentTypeId"
            value={equipmentTypeId}
            onChange={(e) => setEquipmentTypeId(e.target.value)}
            required
          >
            {equipmentTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rateCardId">Rate card</label>
          <select id="rateCardId" value={rateCardId} onChange={(e) => setRateCardId(e.target.value)} required>
            {rateCards.length === 0 && <option value="">(no rate cards seeded for this tenant)</option>}
            {rateCards.map((rc) => (
              <option key={rc.id} value={rc.id}>
                {rc.rateType} @ {rc.currency} {rc.rateValue}/hr
              </option>
            ))}
          </select>
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
        <button type="submit" onClick={preview} disabled={!customerId || !projectSiteId || !equipmentTypeId || !rateCardId}>
          Preview
        </button>
        <button type="submit" onClick={create} disabled={!customerId || !projectSiteId || !equipmentTypeId || !rateCardId}>
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
