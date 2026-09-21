import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { bookingsQueries } from '../lib/queries.js';
import { formatDateTime, formatPeso } from '../lib/format.js';
import { Surface } from './surface.js';
import { Button } from './button.js';
import { Input } from './input.js';

// The counter-offer thread behind Figma 225:3084 (Messenger Chat Nego).
// The frame hands the customer off to Facebook Messenger; this keeps the
// conversation on the booking instead, so an offer sits next to the quote
// it is about. One component for both sides: the API derives who is
// speaking from the JWT, so the customer account and the staff console
// mount the same thread.
export function NegotiationThread({ bookingId, disabled = false }: { bookingId: string; disabled?: boolean }) {
  const queryClient = useQueryClient();
  const messages = useQuery(bookingsQueries.messages(bookingId));
  const [body, setBody] = useState('');
  const [offer, setOffer] = useState('');

  const send = useMutation({
    mutationFn: () =>
      apiPost(`/bookings/${bookingId}/messages`, {
        body: body.trim(),
        ...(offer ? { offerPhp: Number(offer) } : {}),
      }),
    onSuccess: () => {
      setBody('');
      setOffer('');
      return queryClient.invalidateQueries({ queryKey: ['booking', bookingId, 'messages'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) send.mutate();
  }

  return (
    <Surface radius="md" elevation="sm" className="flex min-w-0 flex-col p-0">
      <h2 className="border-b border-border px-4 py-3 font-display text-base font-semibold text-text">
        Conversation
      </h2>

      <ol aria-live="polite" className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.isPending && <li className="text-sm text-text-muted">Loading messages...</li>}
        {messages.isError && (
          <li className="text-sm text-error">The conversation could not be loaded. It retries shortly.</li>
        )}
        {messages.data?.length === 0 && (
          <li className="text-sm text-text-muted">
            No messages yet. Ask a question, or propose a price with a counter-offer.
          </li>
        )}
        {messages.data?.map((message) => (
          <li
            key={message.id}
            className={[
              'flex max-w-[85%] flex-col gap-1 rounded-md border px-3 py-2',
              message.mine ? 'self-end border-primary bg-surface-sunk' : 'self-start border-border bg-surface',
            ].join(' ')}
          >
            <span className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
              {message.mine ? 'You' : message.authorRole === 'staff' ? 'Rental team' : 'Customer'} &middot;{' '}
              {formatDateTime(message.createdAt)}
            </span>
            {message.offerPhp !== null && (
              <span className="font-mono text-base font-semibold text-text">
                Offer: {formatPeso(message.offerPhp)}
              </span>
            )}
            <span className="whitespace-pre-wrap break-words text-sm text-text">{message.body}</span>
          </li>
        ))}
      </ol>

      {!disabled && (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border px-4 py-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={`message-${bookingId}`} className="text-sm font-medium text-text">
              Message
            </label>
            <textarea
              id={`message-${bookingId}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              required
              className="rounded-md border border-border bg-surface px-3 py-2 text-text"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Input
                label="Counter-offer (PHP, optional)"
                id={`offer-${bookingId}`}
                type="number"
                min={1}
                step="0.01"
                numeric
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" loading={send.isPending} disabled={!body.trim()}>
              Send
            </Button>
          </div>
          {send.isError && <p className="text-sm text-error">{apiErrorText(send.error)}</p>}
        </form>
      )}
    </Surface>
  );
}
