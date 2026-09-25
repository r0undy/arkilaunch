import { useSyncExternalStore } from 'react';

// Client-side cart only -- there is no cart table in the backend (a booking
// IS the persisted unit, per bookings.ts's comment: "no new table, the SDD
// §3 catalog already covers both"). sessionStorage mirrors the pattern
// registration-client.ts already uses for multi-step draft state.
export interface CartItem {
  equipmentId: string;
  model: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  // Snapshotted off the catalog row when the machine went in, so the cart
  // renders its line (Figma 168:1982) without refetching the catalog. Both
  // optional: a cart saved before this shipped has neither, and the page
  // falls back rather than breaking.
  equipmentTypeName?: string;
  photoUri?: string | null;
  // Hours the customer means to run it; the cart requires minBookingHours.
  hours?: number | undefined;
}

const CART_KEY = 'arkilaunch.cart';

// The cart is read by three separate places now -- the cart page, the
// sidebar count and the browse rail -- and none of them learned about a
// change made by another. sessionStorage fires no event for its own tab, so
// this is the subscription the components were missing.
//
// `snapshot` is cached deliberately: useSyncExternalStore compares by
// reference, so returning a freshly parsed array each call would re-render
// forever.
const listeners = new Set<() => void>();
let snapshot: CartItem[] | null = null;

function readSnapshot(): CartItem[] {
  if (snapshot === null) snapshot = getCart();
  return snapshot;
}

function publish(items: CartItem[]): void {
  snapshot = items;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The cart, re-rendering the caller whenever any component changes it. */
export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
}

// Touching sessionStorage can THROW, not just return null: Safari's private
// mode and a "block all site data" setting both raise on access. The read was
// only guarded against bad JSON, so the access itself could take the page
// down -- and now that useCart() runs in the sidebar of every console screen,
// that would be the whole app rather than the cart alone.
export function getCart(): CartItem[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]): void {
  // The in-memory snapshot is published whether or not the write lands, so a
  // customer with storage blocked still gets a working cart for this tab --
  // it just does not survive a reload. Losing the write is recoverable;
  // throwing out of an onClick is not.
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded or storage blocked; the snapshot below still stands.
  }
  publish(items);
}

export function addToCart(item: CartItem): void {
  saveCart([...getCart(), item]);
}

// Keeps end after start: moving the start past the end drags the end along
// by a day, since the API refuses an end that is not after the start.
export function updateCartItem(index: number, patch: Partial<CartItem>): void {
  saveCart(
    getCart().map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, ...patch };
      if (new Date(next.end) <= new Date(next.start)) {
        const end = new Date(next.start);
        end.setDate(end.getDate() + 1);
        next.end = end.toISOString();
      }
      return next;
    }),
  );
}

export function removeFromCart(index: number): void {
  saveCart(getCart().filter((_, i) => i !== index));
}

export function clearCart(): void {
  try {
    sessionStorage.removeItem(CART_KEY);
  } catch {
    // Same reasoning as saveCart: the snapshot is the source of truth for
    // this tab either way.
  }
  // Publishes too: this is the one mutator that does not route through
  // saveCart, and it runs right after a booking is placed -- without this
  // the sidebar count and the browse rail keep showing the machines the
  // customer just booked.
  publish([]);
}

// A 1-day rental starting tomorrow -- a default the cart's date fields let
// the customer adjust before submitting.
export function defaultRentalWindow(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
