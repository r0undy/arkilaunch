import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { NegotiationMessageResponse } from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatDateTime, formatPeso } from '../lib/format.js';
import { Button } from './button.js';
import { Input } from './input.js';

// The truck request's negotiation thread: the same negotiation_messages
// rows and rules as a rental's (an offer is a message, never a charge).
// `base` is '/me/truck-requests/:id' for the customer and
// '/truck-requests/:id' for staff; the API scopes each.
export function TruckThread({ base }: { base: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['truck-thread', base] as const;
  const thread = useQuery({
    queryKey,
    queryFn: () => apiGet<NegotiationMessageResponse[]>(`${base}/messages`),
    refetchInterval: 10_000,
  });
  const [body, setBody] = useState('');
  const [offer, setOffer] = useState('');
  const send = useMutation({
    mutationFn: () =>
      apiPost(`${base}/messages`, {
        body: body.trim(),
        ...(Number(offer) > 0 ? { offerPhp: Number(offer) } : {}),
      }),
    onSuccess: () => {
      setBody('');
      setOffer('');
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) send.mutate();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <ol className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-label="Price negotiation">
        {thread.data?.length === 0 && (
          <li className="text-sm text-text-muted">No messages yet. Make an offer or ask a question.</li>
        )}
        {thread.data?.map((m) => (
          <li
            key={m.id}
            className={[
              'max-w-[85%] rounded-md px-3 py-2 text-sm',
              m.mine ? 'self-end bg-primary text-text' : 'self-start bg-surface-sunk text-text',
            ].join(' ')}
          >
            <p>{m.body}</p>
            {m.offerPhp !== null && (
              <p className="font-mono font-semibold tabular-nums">Offer: {formatPeso(m.offerPhp)}</p>
            )}
            <p className="text-xs text-text-muted">
              {m.authorRole === 'staff' ? 'Rental team' : 'Customer'} · {formatDateTime(m.createdAt)}
            </p>
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Input label="Message" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
        <Input
          label="Offer (PHP, optional)"
          type="number"
          min={1}
          inputMode="decimal"
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
        />
        <Button type="submit" variant="secondary" loading={send.isPending} disabled={!body.trim()}>
          Send
        </Button>
      </form>
      {send.isError && (
        <p role="alert" className="text-sm text-error">
          {apiErrorText(send.error)}
        </p>
      )}
    </div>
  );
}
