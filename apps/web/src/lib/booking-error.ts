// The cart reported every failure as "check the equipment is still
// available", which was wrong for most of them and unactionable for the rest:
// a date clash is fixed by moving the dates, a machine in maintenance is not,
// and a validation fault is neither.

function payloadOf(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null) return null;
  const payload = (error as { payload?: unknown }).payload;
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' ? value : null;
}

function num(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key];
  return typeof value === 'number' ? value : null;
}

// Every refusal POST /bookings can answer (bookings.service.ts create, and
// the guards in front of it) has its own sentence here; the generic line is
// left for a real server fault only (QA 24).
export function explainBookingError(error: unknown): string {
  // fetch throws a TypeError when the request never reached the server.
  if (error instanceof TypeError) {
    return 'Could not reach the server, so the booking was not sent. Check your connection and try again.';
  }
  const payload = payloadOf(error);
  const code = str(payload, 'error');
  const status = (error as { status?: number })?.status;
  const alternatives = Array.isArray(payload?.alternatives) ? payload.alternatives.length : 0;
  const more =
    alternatives > 0
      ? ` ${alternatives} similar unit${alternatives === 1 ? ' is' : 's are'} free for those dates.`
      : '';

  switch (code) {
    case 'equipment_unavailable':
      switch (str(payload, 'reason')) {
        case 'overlaps_in_cart':
          return 'The same machine is in your cart twice for overlapping dates. Change the dates on one line or remove it.';
        case 'dates_taken':
          return `That machine is already booked for the dates you picked. Choose a different window.${more}`;
        case 'on_hold':
          return `Another customer is holding that machine for those dates while they arrange payment. The dates free up if they do not pay in time; choose a different window for now.${more}`;
        case 'maintenance_window':
          return `That machine has maintenance scheduled during those dates. Choose a different window.${more}`;
        case 'outside_business_hours':
          return 'Pickup and return have to fall on an open day, within office hours. Move the start or end.';
        case 'holiday':
          return 'Pickup or return falls on an office holiday. Move the start or end to an open day.';
        case 'operator_busy':
          return `The operator for that machine is already out on another job then. Choose a different window.${more}`;
        default:
          return `That machine is not in service right now${str(payload, 'status') ? ` (${str(payload, 'status')})` : ''}, so it cannot be booked.${more}`;
      }
    case 'rental_too_short':
      return `This company rents for at least ${num(payload, 'minDays') ?? 'a minimum number of'} days. Pick a later return date.`;
    case 'hours_below_minimum':
      return `Enter at least ${num(payload, 'minHours') ?? 'the minimum'} hours for those dates: a full working day for each day.`;
    case 'hours_above_maximum':
      return `At most ${num(payload, 'maxHours') ?? 'so many'} hours fit in those dates. Enter fewer hours or pick a later return date.`;
    case 'site_proof_required':
      return 'This site needs its proof first: a photo of the site and a permit, NTP or contract, title or lease, or barangay clearance. Upload it under the site, or pick another site.';
    case 'company_not_verified':
      return str(payload, 'status') === 'rejected'
        ? 'Verification was declined for this company, so it cannot rent. Contact the rental team.'
        : 'This company is still being verified. You can book as soon as the rental team approves it.';
    case 'company_required':
      return 'Choose which of your companies this booking is for.';
    case 'invalid_options':
      return "A machine's options changed since you added it. Check its choices in your cart and try again.";
    case 'project_site_not_found':
      return 'That delivery site is no longer on your account. Pick another site.';
    case 'equipment_not_found':
      return 'That machine is no longer listed. Remove it from your booking and pick another.';
    case 'customer_profile_not_found':
      return 'This account is not linked to a customer profile yet, so it cannot book. Ask your administrator to finish setting it up.';
    case 'customer_scope_denied':
    case 'customer_id_required':
      return 'This account is not allowed to book on behalf of that customer.';
    default:
      if (status === 400) return 'Some of the booking details were rejected. Check the dates and try again.';
      if (status === 401) return 'Your session ended. Sign in again; your cart is saved.';
      if (status === 403) return 'This account is not allowed to make bookings. Ask your administrator for access.';
      if (status === 429) return 'Too many booking attempts just now. Wait a minute and try again.';
      return 'The booking was not created, and nothing has been charged. Try again in a moment.';
  }
}

// The unit that clashed and the free units of the same type the API found
// for the same dates, so the cart can offer a one-click swap (US-09).
export function bookingAlternatives(
  error: unknown,
): { equipmentId: string; alternatives: string[] } | null {
  const payload = payloadOf(error);
  const equipmentId = str(payload, 'equipmentId');
  const alternatives = Array.isArray(payload?.alternatives)
    ? payload.alternatives.filter((id): id is string => typeof id === 'string')
    : [];
  return equipmentId && alternatives.length > 0 ? { equipmentId, alternatives } : null;
}
