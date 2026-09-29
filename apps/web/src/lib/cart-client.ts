import { useSyncExternalStore } from 'react';

export interface CartItem {
  equipmentId: string;
  model: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  equipmentTypeName?: string;
  photoUri?: string | null;
  hours?: number | undefined;
  selectedOptions?: Record<string, string> | undefined;
}

const CART_KEY = 'arkilaunch.cart';

// sessionStorage fires no event in its own tab, hence this store. `snapshot` must stay cached:
// useSyncExternalStore compares by reference and a fresh array each call re-renders forever.
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

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
}

// sessionStorage access itself can throw (Safari private mode, blocked site data).
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
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked: the in-memory snapshot still works for this tab.
  }
  publish(items);
}

export function addToCart(item: CartItem): void {
  saveCart([...readSnapshot(), item]);
}

// The API refuses an end not after the start.
export function updateCartItem(index: number, patch: Partial<CartItem>): void {
  saveCart(
    readSnapshot().map((item, i) => {
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
  saveCart(readSnapshot().filter((_, i) => i !== index));
}

export function clearCart(): void {
  try {
    sessionStorage.removeItem(CART_KEY);
  } catch {
    // Storage blocked: the snapshot is still the truth for this tab.
  }
  publish([]);
}

export function defaultRentalWindow(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  if (start.getDay() === 0) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (end.getDay() === 0) end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
