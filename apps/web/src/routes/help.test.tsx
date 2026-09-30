import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';

afterEach(() => vi.unstubAllGlobals());

describe('Help center', () => {
  it("lists the tenant's own contact channels", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(url).includes('/catalog/tenant')
                ? { name: 'Almara', slug: 'almara', contactEmail: 'ops@almara.ph', phone: '09171234567' }
                : [],
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    await renderRoute('/help');

    expect(await screen.findByRole('link', { name: /ops@almara\.ph/ })).toHaveAttribute('href', 'mailto:ops@almara.ph');
    expect(screen.getAllByRole('link', { name: /09171234567/ }).map((a) => a.getAttribute('href'))).toEqual([
      'tel:09171234567',
      'viber://chat?number=%2B639171234567',
      'https://t.me/+639171234567',
    ]);
    expect(screen.queryByText(/arkilaunch2026@gmail\.com/)).not.toBeInTheDocument();
  });
});
