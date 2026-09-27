import { BOOKING_SERVICE_LABEL, type BookingService } from '@arkilaunch/shared';
import { CopyButton } from './copy-button.js';

// The one way a booking is named on screen, for both services
// (cr-arkilaunch-uniform-booking-codes.md): the database-assigned code in
// the gauge mono face, optionally with the service beside it. Replaces the
// UUID-derived BKG-/RNT- fragments, which named one rental two ways.

export function ServiceBadge({ service }: { service: BookingService }) {
  return (
    <span
      className={[
'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
        service === 'truck' ? 'border-accent text-accent' : 'border-border text-text',
      ].join(' ')}
    >
      {BOOKING_SERVICE_LABEL[service]}
    </span>
  );
}

export function BookingCode({
  code,
  service,
  copyable = false,
  className = '',
}: {
  code: string | null | undefined;
  // Given, the service badge is shown beside the code.
  service?: BookingService;
  // Given, a copy button sits beside the code.
  copyable?: boolean;
  className?: string;
}) {
  return (
    <span className={['inline-flex flex-wrap items-center gap-2', className].join(' ')}>
      <span className="whitespace-nowrap font-mono font-semibold text-text">{code || '--'}</span>
      {copyable && code && <CopyButton value={code} label={`booking code ${code}`} />}
      {service && <ServiceBadge service={service} />}
    </span>
  );
}
