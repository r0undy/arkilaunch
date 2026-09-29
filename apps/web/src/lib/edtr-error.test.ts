import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import { explainEdtrError } from './edtr-error.js';

describe('explainEdtrError', () => {
  it("shows our own validation message rather than hiding it", () => {
    expect(explainEdtrError(new Error('Enter the running hours.')).detail).toBe('Enter the running hours.');
  });

  it('explains a day outside the rental', () => {
    expect(explainEdtrError(new ApiError(422, { error: 'report_date_outside_rental' })).title).toBe('That day is outside the rental');
  });

  it('renders an unmapped API code as a sentence', () => {
    expect(explainEdtrError(new ApiError(404, { error: 'rental_not_found' })).detail).toBe('Rental not found.');
  });

  it('keeps a raw network failure off the screen', () => {
    expect(explainEdtrError(new TypeError('Failed to fetch')).detail).toBe('Try again in a moment.');
  });
});
