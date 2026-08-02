import { createRoute } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { appLayoutRoute } from './_app.js';
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
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';

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

  const canSubmit = !customerId || !projectSiteId || !equipmentTypeId || !rateCardId;

  return (
    <div className="min-h-screen bg-bg p-6">
      <h1 className="mb-6 font-display text-[28px] font-semibold leading-[1.15] text-text sm:text-[34px]">
        Quotes (RFC-3)
      </h1>
      {refError != null && (
        <p className="mb-4 text-error">
          Could not load reference data (customers/equipment/rate cards/sites) -- is the API running? See error
          below.
        </p>
      )}
      <Surface radius="md" elevation="sm" className="mb-6 flex max-w-2xl flex-col gap-4 p-6">
        <form className="flex flex-col gap-4">
          <Select id="customerId" label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.length === 0 && <option value="">(no customers seeded for this tenant)</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </Select>
          <Select
            id="projectSiteId"
            label="Project site"
            value={projectSiteId}
            onChange={(e) => setProjectSiteId(e.target.value)}
            required
          >
            {projectSites.length === 0 && <option value="">(no sites seeded for this tenant)</option>}
            {projectSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.slice(0, 8)} ({s.latitude}, {s.longitude})
              </option>
            ))}
          </Select>
          <Select
            id="equipmentTypeId"
            label="Equipment type"
            value={equipmentTypeId}
            onChange={(e) => setEquipmentTypeId(e.target.value)}
            required
          >
            {equipmentTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.name}
              </option>
            ))}
          </Select>
          <Select id="rateCardId" label="Rate card" value={rateCardId} onChange={(e) => setRateCardId(e.target.value)} required>
            {rateCards.length === 0 && <option value="">(no rate cards seeded for this tenant)</option>}
            {rateCards.map((rc) => (
              <option key={rc.id} value={rc.id}>
                {rc.rateType} @ {rc.currency} {rc.rateValue}/hr
              </option>
            ))}
          </Select>
          <Input
            numeric
            id="quantity"
            label="Quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Input
            numeric
            id="estimatedHours"
            label="Estimated hours"
            type="number"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value)}
          />
          <Input
            numeric
            id="mobilizationKm"
            label="Mobilization km"
            type="number"
            value={mobilizationKm}
            onChange={(e) => setMobilizationKm(e.target.value)}
          />
          <Input
            numeric
            id="demobilizationKm"
            label="Demobilization km"
            type="number"
            value={demobilizationKm}
            onChange={(e) => setDemobilizationKm(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" onClick={preview} disabled={canSubmit}>
              Preview
            </Button>
            <Button type="submit" onClick={create} disabled={canSubmit}>
              Create draft
            </Button>
            <Button type="button" variant="approve" onClick={approve} disabled={!quoteId}>
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

export const quotesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/quotes',
  component: QuotesPage,
});
