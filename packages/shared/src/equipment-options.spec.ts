import { describe, expect, it } from 'vitest';
import { EquipmentOptionGroupsSchema, selectedOptionsError } from './fleet.js';
import { BookingItemRequestSchema } from './bookings.js';

const groups = [
  { name: 'Bucket size', values: ['Standard', '3/4', '1/2'] },
  { name: 'Arm', values: ['Short', 'Long'] },
];

describe('selectedOptionsError', () => {
  it('accepts one valid choice per group', () => {
    expect(selectedOptionsError(groups, { 'Bucket size': '3/4', Arm: 'Long' })).toBeNull();
  });

  it('accepts nothing picked on a unit with no groups', () => {
    expect(selectedOptionsError([], {})).toBeNull();
  });

  it('refuses a missing group', () => {
    expect(selectedOptionsError(groups, { 'Bucket size': '3/4' })).toBe('missing Arm');
  });

  it('refuses a choice the unit does not offer', () => {
    expect(selectedOptionsError(groups, { 'Bucket size': '2/3', Arm: 'Long' })).toBe('2/3 is not a Bucket size choice');
  });

  it('refuses a group the unit does not have', () => {
    expect(selectedOptionsError([], { Colour: 'Yellow' })).toBe('Colour is not an option on this unit');
  });
});

describe('EquipmentOptionGroupsSchema', () => {
  it('refuses duplicate group names and duplicate choices', () => {
    expect(EquipmentOptionGroupsSchema.safeParse([groups[0], groups[0]]).success).toBe(false);
    expect(EquipmentOptionGroupsSchema.safeParse([{ name: 'Arm', values: ['Short', 'Short'] }]).success).toBe(false);
  });

  it('refuses a group with no choices', () => {
    expect(EquipmentOptionGroupsSchema.safeParse([{ name: 'Arm', values: [] }]).success).toBe(false);
  });
});

describe('BookingItemRequestSchema.selectedOptions', () => {
  const base = { equipmentId: '00000000-0000-4000-8000-000000000000', start: '2026-10-01T08:00:00+08:00', end: '2026-10-02T17:00:00+08:00' };

  it('is optional', () => {
    expect(BookingItemRequestSchema.safeParse(base).success).toBe(true);
  });

  it('must map names to string choices', () => {
    expect(BookingItemRequestSchema.safeParse({ ...base, selectedOptions: { Arm: 'Long' } }).success).toBe(true);
    expect(BookingItemRequestSchema.safeParse({ ...base, selectedOptions: { Arm: 3 } }).success).toBe(false);
  });
});
