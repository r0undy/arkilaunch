import { createRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiGet, apiPost, apiErrorText } from '../lib/api-client.js';
import { getEquipmentTypes, getRateCards, type EquipmentTypeRef, type RateCardRef } from '../lib/reference-client.js';
import type { QuoteDetail } from '../lib/queries.js';
import { formatPeso, formatRateType, formatStatus, shortCode } from '../lib/format.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { PageHeader } from '../components/page-header.js';
import { GaugeReadout } from '../components/gauge-readout.js';
import { Modal } from '../components/modal.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { QuoteLines } from '../components/quote-lines.js';
import { useToast } from '../components/toast.js';
import { DieselPriceForm, PricingParametersForm, RateCardsPanel, RentalFeesForm } from './app.settings.js';
import { Tabs } from '../components/tabs.js';
import { SettingsEditor, TollsEditor, settingsQuery as truckSettingsQuery } from './app.trucks.js';

// A quote line as the builder edits it: a catalog machine priced off its
// type's rate card, or a free-text item the admin prices by hand.
type EquipmentLine = {
  key: number;
  kind: 'equipment';
  equipmentTypeId: string;
  rateCardId: string;
  quantity: string;
  // Hours for an hourly card, days for a daily or monthly one.
  duration: string;
  agreed: string;
};
type CustomLine = { key: number; kind: 'custom'; description: string; quantity: string; unitPrice: string };
type Line = EquipmentLine | CustomLine;

let nextKey = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?bookingId= arrives from a booking in negotiation ("Revise quote"). With
// no booking the page is the standard price book: quotes are never drawn up
// per company; every booking is priced from the book automatically.
function validateQuoteSearch(search: Record<string, unknown>): { bookingId?: string } {
  const out: { bookingId?: string } = {};
  if (typeof search.bookingId === 'string' && UUID.test(search.bookingId)) out.bookingId = search.bookingId;
  return out;
}

type PriceBookTab = 'rental' | 'trucking';
const PRICE_BOOK_TABS: Array<{ id: PriceBookTab; label: string }> = [
  { id: 'rental', label: 'Equipment rental' },
  { id: 'trucking', label: 'Trucking' },
];

// The standard price book: one set of prices for every client and prospect.
// Equipment rental is rate cards + operating costs + the fixed mobilization
// and demobilization; trucking is its per-trip fees, extras and tolls. A
// booking is quoted from here the moment it is made.
function PriceBook() {
  const [tab, setTab] = useState<PriceBookTab>('rental');
  const truck = useQuery(truckSettingsQuery);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Price book"
        description="The standard prices every client and prospect is quoted. A booking gets its quote from these at once; you only revise one when the customer negotiates."
      />
      <Tabs label="Service" items={PRICE_BOOK_TABS} value={tab} onChange={setTab} />
      {tab === 'rental' ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <RentalFeesForm />
            <DieselPriceForm />
          </div>
          <PricingParametersForm />
          <RateCardsPanel />
        </>
      ) : (
        <>
          {truck.data && <SettingsEditor initial={truck.data} />}
          {truck.isError && <p className="text-sm text-error">{apiErrorText(truck.error)}</p>}
          <TollsEditor />
        </>
      )}
    </div>
  );
}

function QuotesPage() {
  const { bookingId } = quotesRoute.useSearch();
  return bookingId ? <NegotiatedQuote bookingId={bookingId} /> : <PriceBook />;
}

function hireDays(booking: BookingDetailResponse): number {
  const spans = booking.items.filter((item) => item.end).map((item) => (new Date(item.end!).getTime() - new Date(item.start).getTime()) / 86_400_000);
  return spans.length ? Math.max(1, Math.ceil(Math.max(...spans))) : 1;
}

// DESIGN.md §4.1 Quotation builder, now only for a booking in negotiation:
// it starts from the booking's current quote (priced from the price book),
// and staff meet the customer's counter-offer with an agreed line price or
// a discount. Mobilization/demobilization stay the price book's.
function NegotiatedQuote({ bookingId }: { bookingId: string }) {
  const toast = useToast();
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentTypeRef[]>([]);
  const [rateCards, setRateCards] = useState<RateCardRef[]>([]);
  const [refFailed, setRefFailed] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [projectSiteId, setProjectSiteId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  // A fixed peso discount is how staff meet a customer's counter-offer.
  const [discount, setDiscount] = useState('0');

  const [result, setResult] = useState<QuoteDetail | null>(null);
  // A preview is a decision point, so it opens over the form and carries
  // Create draft in its own footer.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'create' | 'approve' | null>(null);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);

  const cardsFor = (typeId: string) => rateCards.filter((rc) => rc.equipmentTypeId === typeId);

  function equipmentLine(types: EquipmentTypeRef[], cards: RateCardRef[], days = 1): EquipmentLine {
    const typeId = types.find((t) => cards.some((rc) => rc.equipmentTypeId === t.id))?.id ?? types[0]?.id ?? '';
    const card = cards.find((rc) => rc.equipmentTypeId === typeId);
    return {
      key: nextKey++, kind: 'equipment', equipmentTypeId: typeId, rateCardId: card?.id ?? '', quantity: '1',
      duration: String(card?.rateType === 'hourly' ? days * 8 : days), agreed: '',
    };
  }

  useEffect(() => {
    Promise.all([getEquipmentTypes(), getRateCards()])
      .then(async ([et, rc]) => {
        setEquipmentTypes(et);
        setRateCards(rc);
        // A revision is an edit of what the customer saw; with no quote yet
        // (the price book could not price it), one line per booked span.
        const booking = await apiGet<BookingDetailResponse>(`/bookings/${bookingId}`);
        setCustomerId(booking.customerId);
        setProjectSiteId(booking.projectSiteId);
        const current = booking.quotation ? await apiGet<QuoteDetail>(`/quotes/${booking.quotation.id}`) : null;
        if (!current) {
          setLines([equipmentLine(et, rc, hireDays(booking))]);
          return;
        }
        setDiscount(String(current.discount));
        setLines(
          current.lineItems.map((line): Line => {
            if (line.kind === 'custom') {
              return { key: nextKey++, kind: 'custom', description: line.description ?? '', quantity: String(line.quantity), unitPrice: String(line.subtotal / line.quantity) };
            }
            const card = rc.find((r) => r.id === line.rateCardId) ?? rc.find((r) => r.equipmentTypeId === line.equipmentTypeId);
            const hourly = card?.rateType === 'hourly';
            // A retired card can't price a new revision; fall back to the type's live one.
            return {
              key: nextKey++, kind: 'equipment', equipmentTypeId: line.equipmentTypeId ?? '', rateCardId: card?.id ?? '',
              quantity: String(line.quantity), duration: String(hourly ? line.estimatedHours : hireDays(booking)), agreed: '',
            };
          }),
        );
      })
      .catch((err: unknown) => {
        setRefFailed(true);
        toast.error('Could not load the booking to quote', apiErrorText(err));
      });
    // Pick lists are fetched once on mount; the toast context is stable.
  }, []);

  function equipmentTypeName(id: string): string {
    return equipmentTypes.find((et) => et.id === id)?.name ?? 'Unknown equipment type';
  }

  function update(key: number, patch: Partial<EquipmentLine> | Partial<CustomLine>) {
    setLines((prev) => prev.map((line) => (line.key === key ? ({ ...line, ...patch } as Line) : line)));
  }

  function buildBody() {
    return {
      customerId,
      projectSiteId,
      rentalId: bookingId,
      discount: Number(discount) > 0 ? { type: 'fixed', value: Number(discount) } : { type: 'none', value: 0 },
      items: lines.map((line) => {
        if (line.kind === 'custom') {
          return { kind: 'custom', description: line.description, quantity: Number(line.quantity), unitPricePhp: Number(line.unitPrice) };
        }
        const hourly = rateCards.find((rc) => rc.id === line.rateCardId)?.rateType === 'hourly';
        return {
          kind: 'equipment',
          equipmentTypeId: line.equipmentTypeId,
          rateCardId: line.rateCardId,
          quantity: Number(line.quantity),
          estimatedHours: hourly ? Number(line.duration) : 0,
          ...(hourly ? {} : { days: Number(line.duration) }),
          ...(line.agreed ? { agreedSubtotalPhp: Number(line.agreed) } : {}),
        };
      }),
    };
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    setBusy('preview');
    try {
      const res = await apiPost<QuoteDetail>('/quotes/preview', buildBody());
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
      const res = await apiPost<QuoteDetail>('/quotes', buildBody());
      setResult(res);
      setQuoteId(res.id);
      setPreviewOpen(false);
      toast.success('Revised quote drafted', `Total ${formatPeso(res.total)}. Approve it to send.`);
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
      toast.success('Quote approved', 'The customer has been notified.');
    } catch (err) {
      toast.error('Could not approve the quote', apiErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  const incomplete =
    !customerId ||
    !projectSiteId ||
    lines.length === 0 ||
    lines.some((line) => (line.kind === 'custom' ? !line.description.trim() || line.unitPrice === '' : !line.equipmentTypeId || !line.rateCardId));

  function QuoteFigures({ quote }: { quote: QuoteDetail }) {
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
        <QuoteLines quote={quote} typeName={equipmentTypeName} />
        <p className="text-sm text-text-muted">Status {formatStatus(quote.status)}.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Revise quote"
        description="The customer is negotiating. Start from the price book quote they saw and meet their offer with an agreed price or a discount."
      />
      <p className="text-sm text-text">
        Booking{' '}
        <Link to="/app/bookings/$bookingId" params={{ bookingId }} className="font-mono underline">
          {bookingId.slice(0, 8)}
        </Link>
        . Approving the revision sends it to the customer to accept.{' '}
        <Link to="/app/quotes" className="underline">
          Back to the price book
        </Link>
      </p>
      {refFailed && (
        <p className="text-error" role="alert">
          Could not load the booking, equipment or rate cards. Reload the page once the API is reachable.
        </p>
      )}
      <Surface radius="md" elevation="sm" className="flex max-w-3xl flex-col gap-4 p-6">
        <form className="flex flex-col gap-4" onSubmit={preview}>
          <h2 className="text-sm font-semibold uppercase tracking-[0.04em] text-text-muted">Lines</h2>
          {lines.map((line, index) => (
            <fieldset key={line.key} className="flex flex-col gap-3 rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-medium text-text">
                {line.kind === 'custom' ? `Item ${index + 1}` : `Equipment ${index + 1}`}
              </legend>
              {line.kind === 'equipment' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    id={`type-${line.key}`}
                    label="Equipment type"
                    value={line.equipmentTypeId}
                    onChange={(e) => {
                      const card = cardsFor(e.target.value)[0];
                      update(line.key, { equipmentTypeId: e.target.value, rateCardId: card?.id ?? '' });
                    }}
                    required
                  >
                    {equipmentTypes.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    id={`card-${line.key}`}
                    label="Rate card"
                    value={line.rateCardId}
                    onChange={(e) => update(line.key, { rateCardId: e.target.value })}
                    required
                  >
                    {cardsFor(line.equipmentTypeId).length === 0 && <option value="">No rate card for this type</option>}
                    {cardsFor(line.equipmentTypeId).map((rc) => (
                      <option key={rc.id} value={rc.id}>
                        {formatRateType(rc.rateType)}: {formatPeso(rc.rateValue)}
                        {rc.equipmentId ? ` (unit ${shortCode('equipment', rc.equipmentId)})` : ''}
                      </option>
                    ))}
                  </Select>
                  <Input numeric id={`qty-${line.key}`} label="Quantity" type="number" min="1" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                  <Input
                    numeric
                    id={`duration-${line.key}`}
                    label={rateCards.find((rc) => rc.id === line.rateCardId)?.rateType === 'hourly' ? 'Hours' : 'Days'}
                    hint={rateCards.find((rc) => rc.id === line.rateCardId)?.rateType === 'monthly' ? 'Whole months at the monthly rate, leftover days at the daily rate.' : undefined}
                    type="number"
                    min="0"
                    step="0.5"
                    value={line.duration}
                    onChange={(e) => update(line.key, { duration: e.target.value })}
                  />
                  <Input
                    numeric
                    id={`agreed-${line.key}`}
                    label="Agreed line price (PHP, optional)"
                    hint="Only after a negotiation: replaces the computed price for this line."
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.agreed}
                    onChange={(e) => update(line.key, { agreed: e.target.value })}
                  />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <Input id={`desc-${line.key}`} label="Description" value={line.description} maxLength={200} onChange={(e) => update(line.key, { description: e.target.value })} required />
                  <Input numeric id={`qty-${line.key}`} label="Quantity" type="number" min="1" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                  <Input numeric id={`price-${line.key}`} label="Price each (PHP)" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => update(line.key, { unitPrice: e.target.value })} required />
                </div>
              )}
              {lines.length > 1 && (
                <div>
                  <Button type="button" variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}>
                    Remove line
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setLines((prev) => [...prev, equipmentLine(equipmentTypes, rateCards)])}>
              + Add equipment
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLines((prev) => [...prev, { key: nextKey++, kind: 'custom', description: '', quantity: '1', unitPrice: '' }])}
            >
              + Add item
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input numeric id="discount" label="Discount (PHP, fixed)" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={incomplete} loading={busy === 'preview'}>
              Preview price
            </Button>
          </div>
          <p className="text-sm text-text-muted">
            Pricing runs against today&apos;s diesel rate. Mobilization and demobilization are the
            price book&apos;s fixed fees. Nothing is saved until you create the draft.
          </p>
        </form>
      </Surface>

      {quoteId && result && (
        <Surface radius="md" elevation="sm" className="flex max-w-3xl flex-col gap-4 p-6">
          <h2 className="text-lg font-semibold text-text">Revised quote</h2>
          <QuoteFigures quote={result} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="approve"
              onClick={() => setConfirmingApprove(true)}
              loading={busy === 'approve'}
              disabled={result.status === 'approved'}
            >
              {result.status === 'approved' ? 'Approved' : 'Approve'}
            </Button>
            <Link to="/app/quotes/$quoteId/print" params={{ quoteId }}>
              <Button type="button" variant="secondary">
                Print quote
              </Button>
            </Link>
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
      <ConfirmDialog
        open={confirmingApprove}
        tone="approve"
        title="Approve and send this quote?"
        body={
          <p>
            The customer is notified and can accept the revised total of{' '}
            <span className="font-mono font-semibold tabular-nums">{result ? formatPeso(result.total) : ''}</span>.
          </p>
        }
        confirmLabel="Approve and send"
        pending={busy === 'approve'}
        onConfirm={async () => {
          await approve();
          setConfirmingApprove(false);
        }}
        onCancel={() => setConfirmingApprove(false)}
      />
    </div>
  );
}

export const quotesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/quotes',
  // Every price-book endpoint needs pricing:manage, which owner lacks: an
  // owner here got a page of forms that never loaded.
  beforeLoad: requireRole('admin'),
  validateSearch: validateQuoteSearch,
  component: QuotesPage,
});
