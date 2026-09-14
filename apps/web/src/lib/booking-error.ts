// The cart reported every failure as "check the equipment is still
// available", which was wrong for most of them and unactionable for the rest:
// a date clash is fixed by moving the dates, a machine in maintenance is not,
// and a validation fault is neither.

function payloadOf(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null) return null;
  const payload = (error as { payload?: unknown }).payload;
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' ? value : null;
}

export function explainBookingError(error: unknown): string {
  const payload = payloadOf(error);
  const code = str(payload, 'error');
  const alternatives = Array.isArray(payload?.alternatives) ? payload.alternatives.length : 0;
  const more = alternatives > 0 ? ` ${alternatives} similar unit${alternatives === 1 ? ' is' : 's are'} free for those dates.` : '';

  switch (code) {
    case 'equipment_unavailable':
      if (str(payload, 'reason') === 'dates_taken') {
        return `That machine is already booked for the dates you picked. Choose a different window.${more}`;
      }
      return `That machine is not in service right now${str(payload, 'status') ? ` (${str(payload, 'status')})` : ''}, so it cannot be booked.${more}`;
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
      if ((error as { status?: number })?.status === 400) {
        return 'Some of the booking details were rejected. Check the dates and try again.';
      }
      return 'The booking was not created, and nothing has been charged. Try again in a moment.';
  }
}
