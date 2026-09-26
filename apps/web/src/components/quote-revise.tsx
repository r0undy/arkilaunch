import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { bookingsQueries, quotesQueries, type QuoteDetail } from '../lib/queries.js';
import { formatPeso } from '../lib/format.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { useToast } from './toast.js';

// Staff answer a negotiation (docs/cr-arkilaunch-standard-pricing.md): an
// agreed price per line and a peso discount, nothing else. Lines, rates and
// the fixed mobilization/demobilization stay as the standard quote set them.
// The API refuses (negotiation_required) until the customer has written in
// the thread or declined the quote.
export function QuoteRevise({ bookingId, quoteId }: { bookingId: string; quoteId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const quote = useQuery(quotesQueries.detail(quoteId));
  const [agreed, setAgreed] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState('');
  const send = useMutation({
    mutationFn: async () => {
      const revised = await apiPost<QuoteDetail>(`/quotes/${quoteId}/revise`, {
        discount: discount === '' ? { type: 'none', value: 0 } : { type: 'fixed', value: Number(discount) },
        agreedPrices: Object.entries(agreed)
          .filter(([, v]) => v !== '')
          .map(([itemId, v]) => ({ itemId, subtotalPhp: Number(v) })),
      });
      await apiPost(`/quotes/${revised.id}/approve`, {});
    },
    onSuccess: () => {
      setAgreed({});
      setDiscount('');
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(bookingId).queryKey });
      toast.success('Revised quote sent', 'The customer can accept it now.');
    },
    onError: (e) => toast.error('Quote not revised', apiErrorText(e)),
  });
  if (!quote.data) return null;
  const changed = discount !== '' || Object.values(agreed).some((v) => v !== '');
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-sm text-text-muted">
        Answer a counter-offer. Mobilization ({formatPeso(quote.data.mobilization)}) and demobilization (
        {formatPeso(quote.data.demobilization)}) are fixed.
      </p>
      {quote.data.lineItems.map((line) =>
        line.id ? (
          <Input
            key={line.id}
            label={`${line.equipmentTypeName ?? line.description ?? 'Line'} (now ${formatPeso(line.subtotal)})`}
            type="number"
            min="0"
            step="0.01"
            numeric
            placeholder="Agreed price"
            value={agreed[line.id] ?? ''}
            onChange={(e) => setAgreed({ ...agreed, [line.id!]: e.target.value })}
          />
        ) : null,
      )}
      <Input label="Discount (PHP)" type="number" min="0" step="0.01" numeric value={discount} onChange={(e) => setDiscount(e.target.value)} />
      <Button variant="primary" loading={send.isPending} disabled={!changed} onClick={() => send.mutate()}>
        Send revised quote
      </Button>
    </div>
  );
}

// A booking the auto-quote could not price (a rate card or pricing input
// was missing when it was made): quote it from the standard pricing now.
export function StandardQuoteButton({ bookingId }: { bookingId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const quote = useMutation({
    mutationFn: () => apiPost(`/quotes/auto/${bookingId}`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(bookingId).queryKey });
      toast.success('Quote sent', 'Priced from the standard pricing.');
    },
    onError: (e) => toast.error('Not quoted', apiErrorText(e)),
  });
  return (
    <Button variant="primary" loading={quote.isPending} onClick={() => quote.mutate()}>
      Quote from standard pricing
    </Button>
  );
}
