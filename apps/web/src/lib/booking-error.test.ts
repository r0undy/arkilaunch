import { describe, expect, it } from 'vitest';
import { bookingAlternatives, explainBookingError } from './booking-error.js';

describe('bookingAlternatives', () => {
  it('passes the clashing unit and its free alternatives through for a swap', () => {
    const error = {
      payload: { error: 'equipment_unavailable', equipmentId: 'a', alternatives: ['b', 'c'] },
    };
    expect(bookingAlternatives(error)).toEqual({ equipmentId: 'a', alternatives: ['b', 'c'] });
  });

  it('offers nothing when there is no alternative to swap to', () => {
    expect(
      bookingAlternatives({
        payload: { error: 'equipment_unavailable', equipmentId: 'a', alternatives: [] },
      }),
    ).toBeNull();
    expect(bookingAlternatives(new Error('network'))).toBeNull();
  });
});

describe('explainBookingError', () => {
  const generic = explainBookingError({ status: 500, payload: { error: 'internal_error' } });
  const fail = (status: number, payload: Record<string, unknown>) => explainBookingError({ status, payload });

  // Every refusal BookingsService.create can answer (QA 24): none may fall
  // through to the "try again in a moment" line meant for a server fault.
  it.each([
    [403, { error: 'customer_profile_not_found' }],
    [403, { error: 'customer_scope_denied' }],
    [409, { error: 'company_required' }],
    [404, { error: 'customer_id_required' }],
    [404, { error: 'project_site_not_found' }],
    [409, { error: 'company_not_verified', status: 'pending' }],
    [409, { error: 'site_proof_required' }],
    [422, { error: 'rental_too_short', minDays: 63 }],
    [422, { error: 'hours_below_minimum', minHours: 128 }],
    [422, { error: 'hours_above_maximum', maxHours: 384 }],
    [409, { error: 'equipment_unavailable', reason: 'overlaps_in_cart' }],
    [404, { error: 'equipment_not_found' }],
    [422, { error: 'invalid_options' }],
    [409, { error: 'equipment_unavailable', reason: 'not_in_service', status: 'maintenance' }],
    [409, { error: 'equipment_unavailable', reason: 'dates_taken' }],
    [409, { error: 'equipment_unavailable', reason: 'on_hold' }],
    [409, { error: 'equipment_unavailable', reason: 'maintenance_window' }],
    [409, { error: 'equipment_unavailable', reason: 'outside_business_hours' }],
    [409, { error: 'equipment_unavailable', reason: 'holiday' }],
    [409, { error: 'equipment_unavailable', reason: 'operator_busy' }],
    [400, {}],
    [401, {}],
    [403, {}],
    [429, {}],
  ])('%i %o has its own reason', (status, payload) => {
    expect(fail(status, payload)).not.toBe(generic);
  });

  it('names the tenant minimum in days', () => {
    expect(fail(422, { error: 'rental_too_short', minDays: 63 })).toMatch(/63 days/);
  });

  it('tells a dropped connection apart from a server fault', () => {
    expect(explainBookingError(new TypeError('Failed to fetch'))).toMatch(/reach the server/);
  });

  it('keeps office hours apart from "not in service"', () => {
    expect(fail(409, { error: 'equipment_unavailable', reason: 'outside_business_hours' })).toMatch(/office hours/);
  });
});
