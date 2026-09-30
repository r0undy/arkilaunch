import { describe, expect, it } from 'vitest';
import {
  isFixtureEquipmentType,
  planEquipmentTypeCleanup,
} from '../src/maintenance/equipment-type-cleanup.js';

const types = [
  { id: 'other', name: 'Others' },
  { id: 'real', name: 'Excavator' },
  { id: 'fixture', name: 'Money Path Cap Fixture 1790735420565' },
];
const rates = [
  { id: 'fixture-rate', equipment_type_id: 'fixture' },
  { id: 'real-rate', equipment_type_id: 'real' },
];

describe('equipment category cleanup', () => {
  it.each([
    'Money Path Cap Fixture',
    'Money Path Cap Fixture 1790735420565',
    'Rate Card Test Type 1790735420565',
    'Daily Only Type 1790735420565',
  ])('recognizes the known fixture name %s', (name) => {
    expect(isFixtureEquipmentType(name)).toBe(true);
  });
  it.each([
    'Excavator',
    'Others',
    'Backhoe Loader',
    'Boom Lift (Manlift)',
    'Wheel Loader (Payloader)',
    'Test Excavator',
    'Money Path Cap Fixture attachments',
    'Rate Card Test Type',
    'Daily Only Type 123',
    'Excavator 1790735420565',
  ])('preserves legitimate or unrecognized name %s', (name) => {
    expect(isFixtureEquipmentType(name)).toBe(false);
  });
  it('targets only fixture categories and their own rates, using the existing fallback', () => {
    expect(planEquipmentTypeCleanup(types, rates, [])).toEqual({
      typeIds: ['fixture'],
      rateIds: ['fixture-rate'],
      fallbackId: 'other',
    });
  });
  it.each([
    { equipment_type_id: 'fixture', rate_card_id: null },
    { equipment_type_id: null, rate_card_id: 'fixture-rate' },
  ])('refuses cleanup of historical category or rate references', (item) => {
    expect(() => planEquipmentTypeCleanup(types, rates, [item])).toThrow('historical quotes');
  });
  it('leaves unrelated quotation references untouched', () => {
    expect(
      planEquipmentTypeCleanup(types, rates, [
        { equipment_type_id: 'real', rate_card_id: 'real-rate' },
      ]).typeIds,
    ).toEqual(['fixture']);
  });
  it.each([
    { catalog: types.filter((row) => row.id !== 'other') },
    { catalog: [...types, { id: 'second-other', name: 'Others' }] },
  ])('refuses an absent or ambiguous fallback category', ({ catalog }) => {
    expect(() => planEquipmentTypeCleanup(catalog, rates, [])).toThrow('Exactly one');
  });
  it('does nothing on a clean catalog, including without a fallback', () => {
    expect(planEquipmentTypeCleanup([{ id: 'real', name: 'Excavator' }], [], [])).toEqual({
      typeIds: [],
      rateIds: [],
      fallbackId: null,
    });
  });
});
