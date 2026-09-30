import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FieldSheetsPanel, LIMIT_REACHED } from './field-sheets-panel.js';
import { ToastProvider } from './toast.js';

const unit = (equipmentId: string, remainingToday: number) => ({
  rentalId: '11111111-1111-4111-8111-111111111111',
  equipmentId,
  bookingCode: 'EQR-2026-0042',
  unitName: 'Excavator · PC200',
  serialNo: `SN-${equipmentId}`,
  siteName: 'Katipunan Ave, Quezon City',
  downloadsToday: 2 - remainingToday,
  remainingToday,
});

function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <FieldSheetsPanel />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('FieldSheetsPanel', () => {
  it('lists this week’s units and disables a unit that used its daily downloads', async () => {
    mount(
      vi.fn().mockImplementation((url: string) =>
        url.includes('/field/edtr-sheets')
          ? json({ weekStart: '2026-09-28', items: [unit('a', 2), unit('b', 0)] })
          : json({}),
      ),
    );
    expect(await screen.findByText(/SN SN-a/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 left today/)).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('button', { name: 'Download PDF' });
    expect(first).toBeEnabled();
    expect(second).toBeDisabled();
    expect(screen.getByText(new RegExp(LIMIT_REACHED))).toBeInTheDocument();
  });

  it('tells the timekeeper the limit is reached when the server refuses with 429', async () => {
    mount(
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/field/edtr-sheets') && init?.method === 'POST') return json({ error: 'edtr_sheet_daily_limit' }, 429);
        if (url.includes('/field/edtr-sheets')) return json({ weekStart: '2026-09-28', items: [unit('a', 1)] });
        return json({});
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(screen.getAllByText(LIMIT_REACHED).length).toBeGreaterThan(0));
  });

  it('says so when no units are on the timekeeper’s sites this week', async () => {
    mount(vi.fn().mockImplementation(() => json({ weekStart: '2026-09-28', items: [] })));
    expect(await screen.findByText('No units are on your sites this week.')).toBeInTheDocument();
  });
});
