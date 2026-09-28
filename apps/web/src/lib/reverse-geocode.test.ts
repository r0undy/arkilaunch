import { describe, expect, it } from 'vitest';
import { matchPhLocation, toPinAddress } from './reverse-geocode.js';

describe('reverse geocode', () => {
  it('maps Nominatim address parts to street, barangay, city, province, ZIP', () => {
    expect(
      toPinAddress({ house_number: '12', road: 'Ayala Avenue', quarter: 'San Lorenzo', city: 'Makati', state: 'Metro Manila', postcode: '1223' }),
    ).toEqual({ street: '12 Ayala Avenue', barangay: 'San Lorenzo', city: 'Makati', province: 'Metro Manila', region: 'Metro Manila', postalCode: '1223' });
  });

  it('prefers the province over the region-level state', () => {
    expect(toPinAddress({ town: 'Plaridel', province: 'Bulacan', state: 'Central Luzon' }).province).toBe('Bulacan');
  });

  it('finds the PSGC picker entry despite "City of" naming', () => {
    expect(matchPhLocation({ street: '', barangay: '', city: 'Manila', province: 'Metro Manila', region: '', postalCode: '' })).toMatchObject({
      province: 'Metro Manila',
      city: 'City of Manila',
    });
    expect(matchPhLocation({ street: '', barangay: '', city: 'Nowhere', province: '', region: '', postalCode: '' })).toBeNull();
  });

  // Live Nominatim (2026-09-28) at 14.6019, 121.0355: no province, no state.
  const ncr = (city: string) => toPinAddress({ road: 'Ortigas Avenue', city, state_district: 'Eastern Manila District', region: 'Metro Manila' });

  it('reads Metro Manila from the region key', () => {
    expect(ncr('San Juan').province).toBe('Metro Manila');
  });

  it('puts NCR cities in Metro Manila, not a same-named province town', () => {
    expect(matchPhLocation(ncr('San Juan'))).toMatchObject({ province: 'Metro Manila', city: 'City of San Juan' });
    expect(matchPhLocation(ncr('Quezon City'))).toMatchObject({ province: 'Metro Manila', city: 'Quezon City' });
    expect(matchPhLocation(ncr('Makati'))).toMatchObject({ province: 'Metro Manila', city: 'City of Makati' });
  });

  it('keeps provincial towns in their province', () => {
    const at = (city: string, province: string) => ({ street: '', barangay: '', city, province, region: '', postalCode: '' });
    expect(matchPhLocation(at('San Juan', 'Batangas'))).toMatchObject({ province: 'Batangas', city: 'San Juan' });
    expect(matchPhLocation(at('Quezon', 'Quezon'))).toMatchObject({ province: 'Quezon', city: 'Quezon' });
  });

  it('matches the full name when nothing else tells them apart, else gives up', () => {
    const at = (city: string) => ({ street: '', barangay: '', city, province: '', region: '', postalCode: '' });
    expect(matchPhLocation(at('Quezon City'))).toMatchObject({ province: 'Metro Manila' });
    expect(matchPhLocation(at('San Juan'))).toBeNull();
  });
});
