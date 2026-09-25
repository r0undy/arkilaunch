import { describe, expect, it } from 'vitest';
import { matchPhLocation, toPinAddress } from './reverse-geocode.js';

describe('reverse geocode', () => {
  it('maps Nominatim address parts to street, barangay, city, province, ZIP', () => {
    expect(
      toPinAddress({ house_number: '12', road: 'Ayala Avenue', quarter: 'San Lorenzo', city: 'Makati', state: 'Metro Manila', postcode: '1223' }),
    ).toEqual({ street: '12 Ayala Avenue', barangay: 'San Lorenzo', city: 'Makati', province: 'Metro Manila', postalCode: '1223' });
  });

  it('prefers the province over the region-level state', () => {
    expect(toPinAddress({ town: 'Plaridel', province: 'Bulacan', state: 'Central Luzon' }).province).toBe('Bulacan');
  });

  it('finds the PSGC picker entry despite "City of" naming', () => {
    expect(matchPhLocation({ street: '', barangay: '', city: 'Manila', province: 'Metro Manila', postalCode: '' })).toMatchObject({
      province: 'Metro Manila',
      city: 'City of Manila',
    });
    expect(matchPhLocation({ street: '', barangay: '', city: 'Nowhere', province: '', postalCode: '' })).toBeNull();
  });
});
