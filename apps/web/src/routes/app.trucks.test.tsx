import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BanRulesEditor } from './app.trucks.js';
import { ToastProvider } from '../components/toast.js';

afterEach(() => vi.unstubAllGlobals());

describe('BanRulesEditor', () => {
  it('names the field a rule fails on instead of a generic error, and sends nothing', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <ToastProvider>
          <BanRulesEditor />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('City'), 'Makati');
    await userEvent.type(within(dialog).getByLabelText('Province'), 'Metro Manila');
    const days = within(dialog).getByLabelText(/^Days/);
    await userEvent.clear(days);
    await userEvent.type(days, 'Mon,Tue');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByText(/^Days: /)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});
