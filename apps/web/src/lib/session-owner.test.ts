import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOwner, currentOwner, markOwner, watchOwner } from './session-owner.js';

describe('one signed-in account per browser (QA 18)', () => {
  afterEach(() => {
    clearOwner();
    localStorage.clear();
  });

  it('records who is signed in and forgets them on sign-out', () => {
    markOwner('user-a');
    expect(currentOwner()).toBe('user-a');
    clearOwner();
    expect(currentOwner()).toBeNull();
  });

  it('signs a tab out when another account signs in, and only then', () => {
    markOwner('user-a');
    const lost = vi.fn();
    const stop = watchOwner(() => 'user-a', lost);
    window.dispatchEvent(new Event('focus'));
    expect(lost).not.toHaveBeenCalled();

    markOwner('user-b'); // last sign-in wins
    window.dispatchEvent(new StorageEvent('storage', { key: 'arkilaunch.sessionOwner' }));
    expect(lost).toHaveBeenCalledTimes(1);
    stop();
  });

  it('leaves a signed-out tab alone', () => {
    markOwner('user-b');
    const lost = vi.fn();
    const stop = watchOwner(() => null, lost);
    window.dispatchEvent(new Event('focus'));
    expect(lost).not.toHaveBeenCalled();
    stop();
  });
});
