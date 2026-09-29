import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SiteDialog } from './site-dialog.js';
import { ToastProvider } from './toast.js';

vi.mock('leaflet', () => {
  const marker = { addTo: () => marker, on: () => marker, setLatLng: () => marker };
  const map = { setView: () => map, on: () => map, remove: () => {} };
  const layer = { addTo: () => layer };
  return { default: { map: () => map, tileLayer: () => layer, marker: () => marker, divIcon: () => ({}) } };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('../lib/reverse-geocode.js', () => ({ reverseGeocode: () => Promise.resolve(null) }));

const SITE = { id: '22222222-2222-4222-8222-222222222222' };

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <SiteDialog open={open} onClose={() => setOpen(false)} customerId="c-1" />
    </>
  );
}

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function fillIn() {
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 14.6, longitude: 121 } } as GeolocationPosition) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
  await userEvent.type(screen.getByLabelText(/street address/i), '1 Ayala Ave');
  await userEvent.type(screen.getByLabelText(/city/i), 'Makati');
  await userEvent.type(screen.getByLabelText(/province/i), 'Metro Manila');
  const [proof, photo] = document.querySelectorAll<HTMLInputElement>('input[type=file]');
  await userEvent.upload(proof!, new File(['%PDF'], 'permit.pdf', { type: 'application/pdf' }));
  await userEvent.upload(photo!, new File(['jpg'], 'gate.jpg', { type: 'image/jpeg' }));
  expect(screen.getByRole('button', { name: 'Save site' })).toBeEnabled();
}

afterEach(() => vi.unstubAllGlobals());

describe('SiteDialog', () => {
  it('retries a failed upload without creating the site a second time', async () => {
    let uploads = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const reply = (status: number, v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status }));
      if (url.endsWith('/me/sites')) return reply(200, SITE);
      uploads += 1;
      return uploads === 1 ? reply(500, {}) : reply(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDialog();
    await fillIn();

    await userEvent.click(screen.getByRole('button', { name: 'Save site' }));
    await screen.findByText(/server could not complete/i);
    await userEvent.click(screen.getByRole('button', { name: 'Save site' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/me/sites'))).toHaveLength(1);
  });

  it('starts empty again after being closed', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderDialog();
    await fillIn();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));

    expect(screen.getByRole('button', { name: 'Save site' })).toBeDisabled();
    expect(screen.getByText(/click the map to place the pin/i)).toBeInTheDocument();
  });
});
