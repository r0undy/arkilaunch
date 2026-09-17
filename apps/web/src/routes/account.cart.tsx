import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { BookingCreateResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/button.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { apiPost } from '../lib/api-client.js';
import { explainBookingError } from '../lib/booking-error.js';
import { referenceQueries } from '../lib/queries.js';
import { getCart, removeFromCart, clearCart, type CartItem } from '../lib/cart-client.js';

function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => getCart());
  const [projectSiteId, setProjectSiteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingCreateResponse | null>(null);
  const projectSites = useQuery(referenceQueries.projectSites());

  function handleRemove(index: number) {
    removeFromCart(index);
    setItems(getCart());
  }

  const createBooking = useMutation({
    mutationFn: () =>
      apiPost<BookingCreateResponse>('/bookings', {
        projectSiteId,
        items: items.map(({ equipmentId, start, end }) => ({ equipmentId, start, end })),
      }),
    onSuccess: (data) => {
      setBooking(data);
      clearCart();
      setItems([]);
    },
    onError: (err: unknown) => setError(explainBookingError(err)),
  });

  if (booking) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold text-text">Booking created</h1>
        <Surface radius="md" elevation="sm" className="flex flex-col items-start gap-3 p-4">
          <p className="text-text">
            Booking {booking.id.slice(0, 8)} is now {booking.status}.
          </p>
          {/* Payment used to be a button here that called the checkout
              endpoint inline. It now lives on its own screen (Figma
              168:2161), so the cart hands the booking over rather than
              carrying a second copy of the PayMongo handoff. */}
          <Link to="/account/checkout/$bookingId" params={{ bookingId: booking.id }}>
            <Button variant="primary">Proceed to payment</Button>
          </Link>
        </Surface>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-semibold text-text">Cart</h1>
        <EmptyState
          title="Your cart is empty"
          description="Add equipment from the catalog to start a booking."
          action={
            <Link to="/equipment">
              <Button variant="primary">Browse equipments</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Cart</h1>
      <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-4">
        {items.map((item, index) => (
          <div key={`${item.equipmentId}-${index}`} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-text">{item.model}</p>
              <p className="text-sm text-text-muted">
                {new Date(item.start).toLocaleDateString()} - {new Date(item.end).toLocaleDateString()}
              </p>
            </div>
            <Button variant="destructive" size="field" onClick={() => handleRemove(index)}>
              Remove
            </Button>
          </div>
        ))}
      </Surface>

      <Surface radius="md" elevation="sm" className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56">
          <Select
            label="Project site"
            id="cart-project-site"
            required
            value={projectSiteId}
            onChange={(e) => setProjectSiteId(e.target.value)}
            {...(error ? { error } : {})}
          >
            <option value="" disabled>
              Select...
            </option>
            {(projectSites.data ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.city ?? site.province ?? `Site ${site.id.slice(0, 8)}`}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="primary"
          disabled={!projectSiteId || createBooking.isPending}
          loading={createBooking.isPending}
          onClick={() => {
            setError(null);
            createBooking.mutate();
          }}
        >
          Book now
        </Button>
      </Surface>
    </div>
  );
}

export const accountCartRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/cart',
  component: CartPage,
});
