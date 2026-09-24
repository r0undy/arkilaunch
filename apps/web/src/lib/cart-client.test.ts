import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  addToCart,
  clearCart,
  getCart,
  removeFromCart,
  updateCartItem,
  useCart,
  defaultRentalWindow,
} from './cart-client.js';

// The cart is read by three places that do not know about each other -- the
// cart page, the sidebar count and the browse rail. Before useCart they each
// held a private copy and a change in one never reached the others.

function machine(model: string) {
  return { equipmentId: `id-${model}`, model, ...defaultRentalWindow() };
}

describe('useCart', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearCart();
  });

  it('starts from whatever is already stored', () => {
    addToCart(machine('JCB 3CX'));
    const { result } = renderHook(() => useCart());
    expect(result.current.map((i) => i.model)).toEqual(['JCB 3CX']);
  });

  it('re-renders a subscriber when another component adds', () => {
    const { result } = renderHook(() => useCart());
    expect(result.current).toHaveLength(0);
    act(() => addToCart(machine('Case 580N')));
    expect(result.current.map((i) => i.model)).toEqual(['Case 580N']);
  });

  it('re-renders on remove and on update', () => {
    addToCart(machine('A'));
    addToCart(machine('B'));
    const { result } = renderHook(() => useCart());
    expect(result.current).toHaveLength(2);

    act(() => removeFromCart(0));
    expect(result.current.map((i) => i.model)).toEqual(['B']);

    act(() => updateCartItem(0, { model: 'B2' }));
    expect(result.current.map((i) => i.model)).toEqual(['B2']);
  });

  // clearCart is the one mutator that does not route through saveCart, and it
  // runs right after a booking is placed. Miss it and the sidebar keeps
  // counting machines the customer has already booked.
  it('re-renders when the cart is cleared after checkout', () => {
    addToCart(machine('JCB 3CX'));
    const { result } = renderHook(() => useCart());
    expect(result.current).toHaveLength(1);
    act(() => clearCart());
    expect(result.current).toHaveLength(0);
  });

  it('keeps a stable reference between reads so the store cannot loop', () => {
    const { result, rerender } = renderHook(() => useCart());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('drops its subscription on unmount', () => {
    const { unmount } = renderHook(() => useCart());
    unmount();
    // No listener left to call: adding must not throw or warn.
    const spy = vi.spyOn(console, 'error');
    act(() => addToCart(machine('after unmount')));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('survives storage that cannot be read', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => getCart()).not.toThrow();
    spy.mockRestore();
  });
});
