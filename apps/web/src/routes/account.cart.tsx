import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bookingDays, minBookingHours, rentFor, type BookingCreateResponse, type RentUnit } from '@arkilaunch/shared';
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
import { formatPeso, shortCode } from '../lib/format.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import {
  validateCart,
  hasErrors,
  isSelectableCompany,
  companyStatusLabel,
  MAX_SITE_CONTACT,
  MAX_SITE_NOTES,
  type CartFieldErrors,
} from '../lib/cart-validation.js';
import { RangeCalendar, availabilityProblem, useAvailability } from '../components/availability-days.js';
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
  return bookingDays(item.start, item.end);
}

// One cart line's date fields plus its availability grid. Taken days are
// disabled; a window that touches one is flagged and blocks submit.
function CartItemDates({
  item,
  rate,
  onDate,
  onHours,
  onProblem,
  onEstimate,
}: {
  item: CartItem;
  rate: { rateType: string | null; rateValue: number | null } | undefined;
  onDate: (field: 'start' | 'end', value: string, hour: number) => void;
  onHours: (hours: number | undefined) => void;
  onProblem: (problem: string | null) => void;
  onEstimate: (estimate: number | null) => void;
}) {
  const availability = useAvailability(item.equipmentId, item.end);
  const hours = availability.data?.hours;
  const openHour = hours ? Number(hours.openTime.slice(0, 2)) + (hours.openTime.slice(3) === '00' ? 0 : 1) : 8;
  const closeHour = hours ? Number(hours.closeTime.slice(0, 2)) : 17;
  const dailyHours = availability.data?.dailyHours ?? 8;
  const minHours = minBookingHours(rentalDays(item), dailyHours, availability.data?.minHours ?? 0);
  const hoursProblem =
    item.hours === undefined || item.hours < minHours
      ? `Enter at least ${minHours} hours: the admin minimum, or ${dailyHours} hours for each day you picked.`
      : null;
  const problem = availabilityProblem(availability.data, item.start, item.end) ?? hoursProblem;
  useEffect(() => onProblem(problem), [problem, onProblem]);
  // Rent only, from the published card; the quote adds diesel, operator and transport.
  const estimate =
    rate?.rateValue != null && item.hours !== undefined && !hoursProblem
      ? rentFor(rate.rateType as RentUnit, rate.rateValue, item.hours, dailyHours).rentPhp
      : null;
  useEffect(() => onEstimate(estimate), [estimate, onEstimate]);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Rental start"
          type="date"
          value={toDateInput(item.start)}
          min={toDateInput(new Date().toISOString())}
          onChange={(e) => onDate('start', e.target.value, openHour)}
        />
        <Input
          label="Rental end"
          type="date"
          value={toDateInput(item.end)}
          min={toDateInput(item.start)}
          onChange={(e) => onDate('end', e.target.value, closeHour)}
          {...(problem && !hoursProblem ? { error: problem } : {})}
        />
      </div>
      <Input
        label="Rental hours"
        type="number"
        min={minHours}
        step="1"
        numeric
        required
        value={item.hours === undefined ? '' : String(item.hours)}
        onChange={(e) => onHours(e.target.value === '' ? undefined : Number(e.target.value))}
        hint={`At least ${minHours} hours for these dates.${estimate !== null ? ` Estimated rent ${formatPeso(estimate)}.` : ''}`}
        {...(hoursProblem && item.hours !== undefined ? { error: hoursProblem } : {})}
      />
      <RangeCalendar
        equipmentId={item.equipmentId}
        start={item.start}
        end={item.end}
        onRange={(startDate, endDate) => {
          onDate('start', startDate, openHour);
          onDate('end', endDate, closeHour);
        }}
      />
    </>
  );
}

// Figma 168:1982 Cart Page / 219:2226 Nego Options. The frame prices the
// cart on the spot (diesel, toll, driver, helper); nothing can do that
// honestly before the site and dates are known, so the cart submits a
// booking request and the price arrives as a quote to negotiate.
function CartPage() {
  const navigate = useNavigate();
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
  const [submitted, setSubmitted] = useState(false);
  const allCompanies = companies.data ?? [];
  // Only a verified company can be booked against, so "the obvious one" is
  // the only selectable one -- not merely the only one on the account.
  const selectable = allCompanies.filter(isSelectableCompany);
  const companyId = chosenCompanyId || (selectable.length === 1 ? selectable[0]!.id : '');
  const company = allCompanies.find((c) => c.id === companyId);
  const companySites = (sites.data ?? []).filter((site) => site.customerId === companyId);
  const errors: CartFieldErrors = validateCart({
    items,
    companies: allCompanies,
    companyId,
    projectSiteId,
    siteContact,
    siteNotes,
  });
  // Errors stay quiet until the first submit, then follow every keystroke --
  // a form that reddens fields the customer has not reached yet reads as
  // broken rather than helpful.
  // Spread rather than passed as a value: `exactOptionalPropertyTypes` makes
  // an explicit `error={undefined}` a type error on the primitives.
  const show = (field: keyof Omit<CartFieldErrors, 'items'>) => {
    const message = submitted ? errors[field] : undefined;
    return message ? { error: message } : {};
  };

  // A customer with no company yet has nothing to book against -- send them
  // to registration instead of leaving them to notice the empty state.
  useEffect(() => {
    if (companies.data && companies.data.length === 0) {
      void navigate({ to: '/account/companies/new' });
    }
  }, [companies.data, navigate]);

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

  function handleDate(index: number, field: 'start' | 'end', value: string, hour: number) {
    if (!value) return;
    updateCartItem(index, { [field]: fromDateInput(value, hour) });
    setItems(getCart());
  }
  // Availability problems per cart line; any one blocks submit.
  const [problems, setProblems] = useState<Record<number, string | null>>({});
  const reportProblem = useCallback(
    (index: number, problem: string | null) =>
      setProblems((prev) => (prev[index] === problem ? prev : { ...prev, [index]: problem })),
    [],
  );
  const unavailable = items.some((_, index) => problems[index]);
  const [estimates, setEstimates] = useState<Record<number, number | null>>({});
  const reportEstimate = useCallback(
    (index: number, estimate: number | null) =>
      setEstimates((prev) => (prev[index] === estimate ? prev : { ...prev, [index]: estimate })),
    [],
  );
  const rates = useQuery(catalogQueries.equipment());
  const rateById = new Map(rates.data?.items.map((eq) => [eq.id, { rateType: eq.rateType ?? null, rateValue: eq.rateValue ?? null }]));
  // Only a full total is shown: a sum missing an unpriced machine would mislead.
  const lineEstimates = items.map((_, index) => estimates[index] ?? null);
  const estimatedTotal = lineEstimates.every((value) => value !== null)
    ? lineEstimates.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;

  const createBooking = useMutation({
    mutationFn: () =>
      apiPost<BookingCreateResponse>('/bookings', {
        customerId: companyId,
        projectSiteId,
        ...(siteContact.trim() ? { siteContact: siteContact.trim() } : {}),
        ...(siteNotes.trim() ? { siteNotes: siteNotes.trim() } : {}),
        items: items.map(({ equipmentId, start, end, hours }) => ({ equipmentId, start, end, hours })),
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
            Your machines are held for those dates. Each machine is priced from its rate card
            straight away, so your quote is usually waiting on the booking page now; if a machine
            has no published rate, the rental team prices it and notifies you. Ask questions or
            counter-offer any time. Nothing is charged until you accept a quote and pay.
          </p>
          {/* Figma 219:2226 splits "Proceed to Negotiation" into a channel
              choice -- phone call or messenger. The frame puts it on the cart
              beside "Proceed to Payment"; there is no price to pay at that
              point (see the note above the component), so the choice belongs
              here, where the request has actually gone in. Two buttons rather
              than the frame's dropdown: it is two options, and the app has no
              menu primitive worth building one for. */}
          <div className="flex flex-wrap gap-2">
            <Link to="/account/negotiation/$bookingId/chat" params={{ bookingId: booking.id }}>
              <Button variant="primary">Negotiate via messenger</Button>
            </Link>
            <Link to="/account/negotiation/$bookingId/call" params={{ bookingId: booking.id }}>
              <Button variant="secondary">Negotiate by phone</Button>
            </Link>
            <Link to="/account/bookings/$bookingId" params={{ bookingId: booking.id }}>
              <Button variant="ghost">Booking details</Button>
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

  // Every company on the account is pending or rejected. The form would render
  // with nothing selectable and a submit that always refuses, so say why here
  // instead and point at the thing that actually unblocks them.
  if (companies.isSuccess && selectable.length === 0) {
    const anyPending = allCompanies.some((c) => c.kycStatus === 'pending');
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold text-text">Shopping cart</h1>
        <EmptyState
          title={anyPending ? 'Your company is still being verified' : 'No company can rent yet'}
          description={
            anyPending
              ? 'Your cart is saved. The rental team is checking the documents you uploaded; you can request a quote as soon as a company is verified.'
              : 'Verification was declined for the companies on your account. Your cart is saved — add another company or contact the rental team.'
          }
          action={
            <Link to="/account/applications">
              <Button variant="primary">See your applications</Button>
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

      {/* A real <form>: the submit button used to be a bare button whose only
          feedback was being disabled, so a customer could not find out which
          field was at fault. noValidate because the messages come from
          validateCart(), which knows about verification state and stale cart
          dates -- things no HTML constraint can express. */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          setError(null);
          setSwap(null);
          if (hasErrors(errors) || unavailable) {
            // Put the caret on the first thing that is wrong rather than
            // leaving the customer to hunt for the red field.
            const firstInvalid = e.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]');
            firstInvalid?.focus();
            return;
          }
          createBooking.mutate();
        }}
        className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
            <h2 className={heading}>Selected equipment ({items.length})</h2>
            {items.map((item, index) => (
              <div
                key={`${item.equipmentId}-${index}`}
                role="group"
                aria-label={item.model}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex items-start gap-3">
                  {(item.photoUri ?? equipmentImageUrl(item.model)) ? (
                    <img
                      src={item.photoUri ?? equipmentImageUrl(item.model)}
                      alt=""
                      className="h-20 w-28 shrink-0 rounded-sm border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-sunk p-2 text-center text-xs text-text-muted">
                      No photo
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold text-text">{item.model}</p>
                    {/* The frame prints the yard's serial here. That column is
                        deliberately outside the public catalog's allowlist
                        (migration 0028), so this is the same short display code
                        the rest of the app uses for a unit. */}
                    <p className="text-xs uppercase tracking-[0.04em] text-text-muted">
                      {item.equipmentTypeName ? `${item.equipmentTypeName} · ` : ''}
                      {shortCode('equipment', item.equipmentId)}
                    </p>
                    <p className="mt-1 text-sm text-text-muted">
                      {rentalDays(item)} rental {rentalDays(item) === 1 ? 'day' : 'days'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => handleRemove(index)}
                    aria-label={`Remove ${item.model}`}
                  >
                    Remove
                  </Button>
                </div>
                <CartItemDates
                  item={item}
                  rate={rateById.get(item.equipmentId)}
                  onDate={(field, value, hour) => handleDate(index, field, value, hour)}
                  onHours={(hours) => {
                    updateCartItem(index, { hours });
                    setItems(getCart());
                  }}
                  onProblem={(problem) => reportProblem(index, problem)}
                  onEstimate={(estimate) => reportEstimate(index, estimate)}
                />
                {submitted && errors.items[index] && (
                  <p role="alert" className="text-sm text-error">
                    {errors.items[index]}
                  </p>
                )}
              </div>
            ))}
            <Link to="/equipment" className="self-start">
              <Button variant="secondary">Add another machine</Button>
            </Link>
          </Surface>

          <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
            <h2 className={heading}>Logistics and delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Shown whenever there is a choice to make OR a company that
                  cannot be chosen -- hiding the field when the only company is
                  unverified left the customer with a dead submit and no reason
                  on screen. */}
              {(allCompanies.length > 1 || selectable.length === 0) && (
                <Select
                  label="Company"
                  id="cart-company"
                  required
                  value={companyId}
                  {...show('companyId')}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setProjectSiteId('');
                  }}
                >
                  <option value="" disabled>
                    Select...
                  </option>
                  {allCompanies.map((c) => {
                    const status = companyStatusLabel(c);
                    return (
                      <option key={c.id} value={c.id} disabled={!isSelectableCompany(c)}>
                        {c.companyName}
                        {status ? ` — ${status}` : ''}
                      </option>
                    );
                  })}
                </Select>
              )}
              <div className="flex flex-col gap-1">
                <Select
                  label="Project site"
                  id="cart-project-site"
                  required
                  disabled={!companyId}
                  {...show('projectSiteId')}
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
                maxLength={MAX_SITE_CONTACT}
                value={siteContact}
                {...show('siteContact')}
                hint="Optional. Who the driver asks for on arrival."
                onChange={(e) => setSiteContact(e.target.value)}
              />
            </div>
            <Input
              label="Site access notes"
              placeholder="Gate hours, road limits, where to unload"
              maxLength={MAX_SITE_NOTES}
              value={siteNotes}
              {...show('siteNotes')}
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
            {estimatedTotal !== null && (
              <div className="flex justify-between gap-3 font-semibold">
                <span className="text-text">Estimated rent</span>
                <span className="text-text" data-testid="cart-estimate">{formatPeso(estimatedTotal)}</span>
              </div>
            )}
          </div>
          <p className="border-t border-border pt-3 text-sm text-text-muted">
            Your quote is priced automatically from each machine&apos;s rate card, with diesel,
            operator and upkeep, as soon as you submit. Transport to your site can be added by the
            rental team. You can negotiate it before anything is charged.
          </p>
          {/* Not disabled on invalid: a dead button explains nothing. It
              submits, validation runs, and the form says what is wrong. */}
          <Button
            type="submit"
            variant="primary"
            disabled={createBooking.isPending || unavailable}
            loading={createBooking.isPending}
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
      </form>
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
