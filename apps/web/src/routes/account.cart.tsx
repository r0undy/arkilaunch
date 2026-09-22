import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BookingCreateResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { StatusPill } from '../components/status-pill.js';
import { CheckIcon } from '../components/icons.js';
import { apiPost } from '../lib/api-client.js';
import { bookingAlternatives, explainBookingError } from '../lib/booking-error.js';
import { catalogQueries, companiesQueries, customerSitesQueries } from '../lib/queries.js';
import { SiteDialog } from '../components/site-dialog.js';
import { shortCode } from '../lib/format.js';
import {
  getCart,
  removeFromCart,
  clearCart,
  updateCartItem,
  type CartItem,
} from '../lib/cart-client.js';

const heading = 'font-display text-sm font-semibold uppercase tracking-[0.04em] text-text-muted';

// <input type="date"> speaks YYYY-MM-DD in local time; the cart stores ISO.
function toDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string, hour: number): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour).toISOString();
}

function rentalDays(item: CartItem): number {
  return Math.max(
    1,
    Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 86_400_000),
  );
}

// Figma 168:1982 Cart Page / 219:2226 Nego Options. The frame prices the
// cart on the spot (diesel, toll, driver, helper); nothing can do that
// honestly before the site and dates are known, so the cart submits a
// booking request and the price arrives as a quote to negotiate.
function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => getCart());
  const [chosenCompanyId, setCompanyId] = useState('');
  const [projectSiteId, setProjectSiteId] = useState('');
  const [siteOpen, setSiteOpen] = useState(false);
  const [siteContact, setSiteContact] = useState('');
  const [siteNotes, setSiteNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [swap, setSwap] = useState<ReturnType<typeof bookingAlternatives>>(null);
  const catalog = useQuery({ ...catalogQueries.equipment(), enabled: swap !== null });
  const [booking, setBooking] = useState<BookingCreateResponse | null>(null);
  const companies = useQuery(companiesQueries.mine());
  const sites = useQuery(customerSitesQueries.mine());
  // One company is the common case: pick it without asking.
  const companyId = chosenCompanyId || (companies.data?.length === 1 ? companies.data[0]!.id : '');
  const company = companies.data?.find((c) => c.id === companyId);
  const companySites = (sites.data ?? []).filter((site) => site.customerId === companyId);

  function handleRemove(index: number) {
    removeFromCart(index);
    setItems(getCart());
  }

  function handleSwap(equipmentId: string, model: string) {
    items.forEach((item, index) => {
      if (item.equipmentId === swap?.equipmentId) updateCartItem(index, { equipmentId, model });
    });
    setItems(getCart());
    setSwap(null);
    setError(null);
  }

  function handleDate(index: number, field: 'start' | 'end', value: string) {
    if (!value) return;
    updateCartItem(index, { [field]: fromDateInput(value, field === 'start' ? 8 : 17) });
    setItems(getCart());
  }

  const createBooking = useMutation({
    mutationFn: () =>
      apiPost<BookingCreateResponse>('/bookings', {
        customerId: companyId,
        projectSiteId,
        ...(siteContact.trim() ? { siteContact: siteContact.trim() } : {}),
        ...(siteNotes.trim() ? { siteNotes: siteNotes.trim() } : {}),
        items: items.map(({ equipmentId, start, end }) => ({ equipmentId, start, end })),
      }),
    onSuccess: (data) => {
      setBooking(data);
      clearCart();
      setItems([]);
    },
    onError: (err: unknown) => {
      setError(explainBookingError(err));
      setSwap(bookingAlternatives(err));
    },
  });

  if (booking) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-4 p-6">
          <StatusPill tone="recon-approved" label="Request sent" icon={<CheckIcon />} />
          <h1 className="font-display text-2xl font-semibold text-text">
            Booking {shortCode('booking', booking.id)} is in
          </h1>
          <p className="text-sm text-text-muted">
            Your machines are held for those dates while the rental team prices the job. You will
            get a notification when the quote is ready; you can ask questions or make a
            counter-offer in the meantime. Nothing is charged until you accept a quote and pay.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/account/negotiation/$bookingId" params={{ bookingId: booking.id }}>
              <Button variant="primary">Go to negotiation</Button>
            </Link>
            <Link to="/account/bookings/$bookingId" params={{ bookingId: booking.id }}>
              <Button variant="secondary">Booking details</Button>
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold text-text">Shopping cart</h1>
        <EmptyState
          title="Your cart is empty"
          description="Add equipment from the catalog to start a booking."
          action={
            <Link to="/equipment">
              <Button variant="primary">Browse equipment</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (companies.data && companies.data.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold text-text">Shopping cart</h1>
        <EmptyState
          title="Add your company first"
          description="Your cart is saved. Tell us which company you are renting for, then come back to request a quote."
          action={
            <Link to="/account/companies/new">
              <Button variant="primary">Add a company</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const totalDays = items.reduce((sum, item) => sum + rentalDays(item), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">Shopping cart</h1>
        <Link to="/equipment" className="text-sm text-accent underline">
          Continue browsing
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
            <h2 className={heading}>Selected equipment ({items.length})</h2>
            {items.map((item, index) => (
              <div
                key={`${item.equipmentId}-${index}`}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-lg font-semibold text-text">{item.model}</p>
                  <Button
                    variant="ghost"
                    onClick={() => handleRemove(index)}
                    aria-label={`Remove ${item.model}`}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Rental start"
                    type="date"
                    value={toDateInput(item.start)}
                    min={toDateInput(new Date().toISOString())}
                    onChange={(e) => handleDate(index, 'start', e.target.value)}
                  />
                  <Input
                    label="Rental end"
                    type="date"
                    value={toDateInput(item.end)}
                    min={toDateInput(item.start)}
                    onChange={(e) => handleDate(index, 'end', e.target.value)}
                  />
                </div>
              </div>
            ))}
            <Link to="/equipment" className="self-start">
              <Button variant="secondary">Add another machine</Button>
            </Link>
          </Surface>

          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
            <h2 className={heading}>Logistics and delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(companies.data?.length ?? 0) > 1 && (
                <Select
                  label="Company"
                  id="cart-company"
                  required
                  value={companyId}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setProjectSiteId('');
                  }}
                >
                  <option value="" disabled>
                    Select...
                  </option>
                  {companies.data!.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </Select>
              )}
              <div className="flex flex-col gap-1">
                <Select
                  label="Project site"
                  id="cart-project-site"
                  required
                  disabled={!companyId}
                  value={projectSiteId}
                  onChange={(e) => setProjectSiteId(e.target.value)}
                >
                  <option value="" disabled>
                    {companySites.length === 0 ? 'No sites yet' : 'Select...'}
                  </option>
                  {companySites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.line1}, {site.city}
                    </option>
                  ))}
                </Select>
                {companyId && (
                  <button
                    type="button"
                    className="self-start text-sm text-accent underline"
                    onClick={() => setSiteOpen(true)}
                  >
                    Add a site
                  </button>
                )}
              </div>
              <Input
                label="Contact on site"
                placeholder="Name and mobile number"
                maxLength={200}
                value={siteContact}
                onChange={(e) => setSiteContact(e.target.value)}
              />
            </div>
            <Input
              label="Site access notes"
              placeholder="Gate hours, road limits, where to unload"
              maxLength={1000}
              value={siteNotes}
              onChange={(e) => setSiteNotes(e.target.value)}
            />
          </Surface>
        </div>

        <Surface radius="md" elevation="sm" className="flex h-fit flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold text-text">Cost summary</h2>
          {company && company.kycStatus !== 'approved' && (
            <p className="rounded-md border border-border bg-surface-sunk px-3 py-2 text-sm text-text">
              {company.companyName} is not verified yet. You can request a quote now; payment
              unlocks once the rental team verifies the company.
            </p>
          )}
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">Machines</span>
              <span className="text-text">{items.length}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">Machine-days</span>
              <span className="text-text">{totalDays}</span>
            </div>
          </div>
          <p className="border-t border-border pt-3 text-sm text-text-muted">
            Diesel, transport, operator and helper costs depend on your site and dates, so the
            rental team prices them in a quote. You can negotiate it before anything is charged.
          </p>
          <Button
            variant="primary"
            disabled={!projectSiteId || !companyId || createBooking.isPending}
            loading={createBooking.isPending}
            onClick={() => {
              setError(null);
              setSwap(null);
              createBooking.mutate();
            }}
          >
            Request a quote
          </Button>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          {swap && (
            <ul className="flex flex-wrap gap-2" aria-label="Free units for those dates">
              {swap.alternatives.map((id) => {
                const unit = catalog.data?.items.find((eq) => eq.id === id);
                const model = unit?.model ?? shortCode('equipment', id);
                return (
                  <li key={id}>
                    <Button variant="secondary" onClick={() => handleSwap(id, model)}>
                      Swap to {model}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>
      </div>
      {companyId && (
        <SiteDialog
          open={siteOpen}
          onClose={() => setSiteOpen(false)}
          customerId={companyId}
          onCreated={(site) => setProjectSiteId(site.id)}
        />
      )}
    </div>
  );
}

export const accountCartRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/cart',
  component: CartPage,
});
