import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';

vi.mock('../lib/host.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/host.js')>()),
  currentHost: { kind: 'platform' },
  tenantSlug: () => null,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Platform directory', () => {
  it('keeps a category picked while the name search is still debouncing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(url).includes('/catalog/tenants')
                ? { items: [], total: 0, categories: ['Excavator'], locations: [] }
                : [],
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    const { router } = await renderRoute('/');
    const chip = await screen.findByRole('button', { name: 'Excavator' });

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'alm' } });
    fireEvent.click(chip);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(router.state.location.search).toMatchObject({ q: 'alm', category: 'Excavator' });
  });
});
