import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CaptureModal } from './capture-modal.js';
import { ToastProvider } from './toast.js';

const LOG_ID = '11111111-1111-4111-8111-111111111111';
const RENTAL = { id: 'rental-1', code: 'BK-1', customerId: 'c', projectSiteId: 's', startDate: null, endDate: null };
const EQUIPMENT = { id: 'eq-1', model: 'CAT 320D', serialNo: 'SN-1', equipmentTypeId: 't', availabilityStatus: 'deployed' };

function Harness() {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setRenders((n) => n + 1)}>
        rerender {renders}
      </button>
      <CaptureModal
        open
        onClose={() => {}}
        rentals={[RENTAL] as never}
        equipmentList={[EQUIPMENT] as never}
        rentalLabel={() => 'Almara'}
        onCaptured={() => {}}
      />
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CaptureModal', () => {
  it('makes staff choose the machine, polls /edtr/:id once and locks Record after success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (url.includes('/reference/capabilities')) return json({ ocrPipeline: false });
      if (init?.method === 'POST') return json({ id: LOG_ID, pollUrl: `/api/v1/edtr/${LOG_ID}` });
      return json({ id: LOG_ID, status: 'reconciled', lineItems: [], fields: [], reconciliation: null });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('combobox', { name: /machine/i })).toHaveTextContent('Choose the machine');
    await userEvent.click(screen.getByRole('button', { name: /day worked/i }));
    const calendar = screen.getByRole('dialog', { name: 'Choose day worked' });
    const [month, year] = calendar.querySelectorAll('select[aria-hidden]');
    fireEvent.change(year!, { target: { value: '2026' } });
    fireEvent.change(month!, { target: { value: '09' } });
    await userEvent.click(screen.getByRole('button', { name: /september 1, 2026/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Select date' }));
    const record = screen.getByRole('button', { name: 'Record log' });
    expect(record).toBeDisabled();

    fireEvent.change(document.querySelector('select[aria-hidden] option[value="eq-1"]')!.parentElement!, {
      target: { value: 'eq-1' },
    });
    await userEvent.click(record);

    expect(await screen.findByText(/recorded as/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /rerender/ }));

    const gets = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(`/edtr/${LOG_ID}`));
    expect(gets).toEqual([`/api/v1/edtr/${LOG_ID}`]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record log' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    fireEvent.submit(screen.getByRole('button', { name: /day worked/i }).closest('form')!);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
