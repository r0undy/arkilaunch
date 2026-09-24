import { createRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { appLayoutRoute } from './_app.js';
import { apiPost, apiErrorText } from '../lib/api-client.js';
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
import { PageHeader } from '../components/page-header.js';
import { GaugeReadout } from '../components/gauge-readout.js';
import { Modal } from '../components/modal.js';
import { Table, type TableColumn } from '../components/table.js';
import { useToast } from '../components/toast.js';

// Wire shape returned by QuotesService.preview/create (apps/api/src/quotes/quotes.service.ts).
interface QuoteLineItem {
  equipmentTypeId: string;
  quantity: number;
  estimatedHours: number;
  hourlyRate: number;
  subtotal: number;
}
interface QuoteResult {
  status: string;
  dieselPrice: number;
  dieselPriceDate: string;
  priceStale: boolean;
  lineItems: QuoteLineItem[];
  subtotal: number;
  discount: number;
  total: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?bookingId=&customerId= arrive from a booking's "Quote this booking":
// the quote is then tied to that booking so the customer can accept it.
function validateQuoteSearch(search: Record<string, unknown>): { bookingId?: string; customerId?: string } {
  const out: { bookingId?: string; customerId?: string } = {};
  if (typeof search.bookingId === 'string' && UUID.test(search.bookingId)) out.bookingId = search.bookingId;
  if (typeof search.customerId === 'string' && UUID.test(search.customerId)) out.customerId = search.customerId;
  return out;
}

// DESIGN.md §4.1 Quotation builder: rate-card selector + live diesel Gauge
// Readout (with date + staleness label) + computed line items.
function QuotesPage() {
  const toast = useToast();
  const { bookingId, customerId: bookingCustomerId } = quotesRoute.useSearch();
  const [customers, setCustomers] = useState<CustomerRef[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentTypeRef[]>([]);
  const [rateCards, setRateCards] = useState<RateCardRef[]>([]);
  const [projectSites, setProjectSites] = useState<ProjectSiteRef[]>([]);
  const [refFailed, setRefFailed] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [projectSiteId, setProjectSiteId] = useState('');
  const [equipmentTypeId, setEquipmentTypeId] = useState('');
  const [rateCardId, setRateCardId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [estimatedHours, setEstimatedHours] = useState('8');
  const [mobilizationKm, setMobilizationKm] = useState('0');
  const [demobilizationKm, setDemobilizationKm] = useState('0');
  const [agreedPrice, setAgreedPrice] = useState('');
  // A fixed peso discount is how staff meet a customer's counter-offer.
  const [discount, setDiscount] = useState('0');

  const [result, setResult] = useState<QuoteResult | null>(null);
  // The priced figures used to appear inline below the form, so Preview and
  // Create sat side by side as two blind sibling buttons and the price
  // scrolled off under a long form. A preview is a decision point, so it
  // opens over the form and carries Create draft in its own footer.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'create' | 'approve' | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCustomers(), getEquipmentTypes(), getRateCards(), getProjectSites()])
      .then(([c, et, rc, ps]) => {
        setCustomers(c);
        setEquipmentTypes(et);
        setRateCards(rc);
        setProjectSites(ps);
        const preset = bookingCustomerId && c.find((customer) => customer.id === bookingCustomerId);
        if (preset) setCustomerId(preset.id);
        else if (c[0]) setCustomerId(c[0].id);
        if (et[0]) setEquipmentTypeId(et[0].id);
        if (rc[0]) setRateCardId(rc[0].id);
        if (ps[0]) setProjectSiteId(ps[0].id);
      })
      .catch((err: unknown) => {
        setRefFailed(true);
        toast.error('Could not load the quote reference data', apiErrorText(err));
      });
    // Pick lists are fetched once on mount; the toast context is stable.
  }, []);

  // The line-item table printed a UUID slice for the machine being priced,
  // while its name was already on the page in the equipment-type picker.
  function equipmentTypeName(id: string): string {
    return equipmentTypes.find((et) => et.id === id)?.name ?? 'Unknown equipment type';
  }

  const lineItemColumns: TableColumn<QuoteLineItem>[] = [
    { header: 'Equipment type', cell: (row) => equipmentTypeName(row.equipmentTypeId) },
    { header: 'Qty', cell: (row) => String(row.quantity), align: 'right' },
    { header: 'Hours', cell: (row) => row.estimatedHours.toFixed(2), align: 'right' },
    { header: 'Rate (PHP/h)', cell: (row) => row.hourlyRate.toFixed(2), align: 'right' },
    { header: 'Subtotal (PHP)', cell: (row) => row.subtotal.toFixed(2), align: 'right' },
  ];

  function buildBody() {
    return {
      customerId,
      projectSiteId,
      ...(bookingId ? { rentalId: bookingId } : {}),
      discount: Number(discount) > 0 ? { type: 'fixed', value: Number(discount) } : { type: 'none', value: 0 },
      items: [
        {
          equipmentTypeId,
          rateCardId,
          quantity: Number(quantity),
          estimatedHours: Number(estimatedHours),
          mobilizationKm: Number(mobilizationKm),
          demobilizationKm: Number(demobilizationKm),
          ...(agreedPrice ? { agreedSubtotalPhp: Number(agreedPrice) } : {}),
        },
      ],
    };
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    setBusy('preview');
    try {
      const res = await apiPost<QuoteResult>('/quotes/preview', buildBody());
      setResult(res);
      setPreviewOpen(true);
      if (res.priceStale) {
        toast.show({
          tone: 'info',
          title: 'Priced against a stale diesel rate',
          detail: `The newest price on file is from ${res.dieselPriceDate}.`,
        });
      }
    } catch (err) {
      toast.error('Could not price that quote', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy('create');
    try {
      const res = await apiPost<QuoteResult & { id: string }>('/quotes', buildBody());
      setResult(res);
      setQuoteId(res.id);
      setPreviewOpen(false);
      toast.success('Draft quote created', `Total ${res.total.toFixed(2)} PHP. Approve it to send.`);
    } catch (err) {
      toast.error('Could not create the draft', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!quoteId) return;
    setBusy('approve');
    try {
      // approve answers { id, status } only; keep the priced figures.
      const res = await apiPost<{ status: string }>(`/quotes/${quoteId}/approve`, {});
      setResult((prev) => (prev ? { ...prev, status: res.status } : prev));
      toast.success('Quote approved', bookingId ? 'The customer has been notified.' : undefined);
    } catch (err) {
      toast.error('Could not approve the quote', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  const incomplete = !customerId || !projectSiteId || !equipmentTypeId || !rateCardId;

  function QuoteFigures({ quote }: { quote: QuoteResult }) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <GaugeReadout
            label="Diesel price"
            value={quote.dieselPrice.toFixed(2)}
            unit="PHP/L"
            stale={quote.priceStale}
            staleLabel={`as of ${quote.dieselPriceDate}`}
          />
          <GaugeReadout label="Total" value={quote.total.toFixed(2)} unit="PHP" />
        </div>
        <Table
          columns={lineItemColumns}
          rows={quote.lineItems}
          rowKey={(row) => row.equipmentTypeId}
        />
        <p className="text-sm text-text-muted">
          Subtotal {quote.subtotal.toFixed(2)} PHP, discount {quote.discount.toFixed(2)} PHP, status{' '}
          {quote.status}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Billing"
        title="Quotes"
        description="Price a quote against today's diesel rate."
      />
      {bookingId && (
        <p className="text-sm text-text">
          Quoting booking{' '}
          <Link to="/app/bookings/$bookingId" params={{ bookingId }} className="font-mono underline">
            {bookingId.slice(0, 8)}
          </Link>
          . Approving it sends it to the customer to accept.
        </p>
      )}
      {refFailed && (
        <p className="text-error" role="alert">
          Could not load customers, equipment, rate cards or sites. Reload the page once the API is
          reachable.
        </p>
      )}
      <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
        <form className="flex flex-col gap-4" onSubmit={preview}>
          <Select
            id="customerId"
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            required
          >
            {customers.length === 0 && <option value="">No customers on file yet</option>}
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
            {projectSites.length === 0 && <option value="">No project sites yet</option>}
            {projectSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.city ?? s.province ?? `Site ${s.id.slice(0, 8)}`} ({s.latitude}, {s.longitude})
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
          <Select
            id="rateCardId"
            label="Rate card"
            value={rateCardId}
            onChange={(e) => setRateCardId(e.target.value)}
            required
          >
            {rateCards.length === 0 && <option value="">No rate cards set up yet</option>}
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
          <Input
            numeric
            id="agreedPrice"
            label="Agreed line price (PHP, optional)"
            type="number"
            min="0"
            step="0.01"
            value={agreedPrice}
            onChange={(e) => setAgreedPrice(e.target.value)}
          />
          <Input
            numeric
            id="discount"
            label="Discount (PHP, fixed)"
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={incomplete} loading={busy === 'preview'}>
              Preview price
            </Button>
          </div>
          <p className="text-sm text-text-muted">
            Pricing runs against today&apos;s diesel rate. Nothing is saved until you create the
            draft.
          </p>
        </form>
      </Surface>

      {quoteId && result && (
        <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
          <h2 className="font-display text-lg font-semibold text-text">Draft quote</h2>
          <QuoteFigures quote={result} />
          <div>
            <Button
              type="button"
              variant="approve"
              onClick={approve}
              loading={busy === 'approve'}
              disabled={result.status === 'approved'}
            >
              {result.status === 'approved' ? 'Approved' : 'Approve'}
            </Button>
          </div>
        </Surface>
      )}

      <Modal
        open={previewOpen && result != null}
        onClose={() => setPreviewOpen(false)}
        title="Quote preview"
        description="Nothing has been saved yet. Create the draft to keep these figures."
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={create} loading={busy === 'create'}>
              Create draft
            </Button>
          </>
        }
      >
        {result && <QuoteFigures quote={result} />}
      </Modal>
    </div>
  );
}

export const quotesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/quotes',
  validateSearch: validateQuoteSearch,
  component: QuotesPage,
});
