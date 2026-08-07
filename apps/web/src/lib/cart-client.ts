// Client-side cart only -- there is no cart table in the backend (a booking
// IS the persisted unit, per bookings.ts's comment: "no new table, the SDD
// §3 catalog already covers both"). sessionStorage mirrors the pattern
// registration-client.ts already uses for multi-step draft state.
export interface CartItem {
  equipmentId: string;
  model: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
}

const CART_KEY = 'arkilaunch.cart';

export function getCart(): CartItem[] {
  const raw = sessionStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]): void {
  sessionStorage.setItem(CART_KEY, JSON.stringify(items));
}

export function addToCart(item: CartItem): void {
  saveCart([...getCart(), item]);
}

export function removeFromCart(index: number): void {
  saveCart(getCart().filter((_, i) => i !== index));
}

export function clearCart(): void {
  sessionStorage.removeItem(CART_KEY);
}

// A 1-day rental starting tomorrow -- a reasonable default the account/cart
// page lets the customer adjust before submitting; there is no date-picker
// UI on the equipment detail page itself.
export function defaultRentalWindow(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
