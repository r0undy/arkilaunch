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
  sessionStorage.removeItem(CART_KEY);
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
