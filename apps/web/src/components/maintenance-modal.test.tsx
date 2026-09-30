import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MaintenanceModal } from './maintenance-modal.js';
import { ToastProvider } from './toast.js';

afterEach(() => vi.unstubAllGlobals());

describe('MaintenanceModal', () => {
  it("refreshes the inventory's ending-soon banner when dates are blocked", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).endsWith('/maintenance')
            ? new Response(JSON.stringify({ schedules: [], windows: [], logs: [] }), { status: 200 })
            : String(url).endsWith('/report')
              ? new Response('{}', { status: 500 })
              : new Response('{}', { status: 200 }),
        ),
      ),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MaintenanceModal equipment={{ id: 'eq-1', model: 'CAT 320D', serialNo: 'SN-1' } as never} onClose={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('tab', { name: /blocked dates/i }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01T08:00' } });
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '2026-10-02T08:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Block dates' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['maintenance-windows', 'ending-soon'] }));
  });
});
