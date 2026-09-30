import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

afterEach(() => vi.unstubAllGlobals());

async function renderCall(phone: string | null) {
  setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('/catalog/tenant') ? { name: 'Almara', slug: 'almara', phone } : {}),
          { status: 200 },
        ),
      ),
    ),
  );
  await renderRoute('/account/negotiation/b1/call');
}

describe('Negotiate by phone', () => {
  it('deep-links the tenant mobile into Viber and Telegram', async () => {
    await renderCall('0917 123 4567');
    expect(await screen.findByRole('link', { name: 'Call on Viber' })).toHaveAttribute('href', 'viber://call?number=%2B639171234567');
    expect(screen.getByRole('link', { name: 'Message on Telegram' })).toHaveAttribute('href', 'https://t.me/+639171234567');
  });

  it('falls back to the contact page without a mobile number', async () => {
    await renderCall(null);
    expect(await screen.findByRole('link', { name: 'Contact page' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Call on Viber' })).not.toBeInTheDocument();
  });
});
