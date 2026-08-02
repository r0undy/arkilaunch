// Storefront catalog fixtures. No public catalog endpoint exists yet
// (bookings were built authenticated-only, cr-arkilaunch-f2-f8-bookings-payments.md);
// shaped like the eventual GET /catalog/equipment response so swapping to a
// real fetch later is a one-line change, not a rewrite.
export interface CatalogEquipment {
  id: string;
  model: string;
  make: string;
  equipmentType: string;
}

export const CATALOG_FIXTURES: CatalogEquipment[] = [
  { id: 'eq-1', model: 'Back Hoe', make: 'CAT', equipmentType: 'backhoe' },
  { id: 'eq-2', model: 'Bulldozer', make: 'Mitsubishi', equipmentType: 'bulldozer' },
  { id: 'eq-3', model: 'Self-Loading Truck', make: 'Isuzu', equipmentType: 'truck' },
  { id: 'eq-4', model: 'Dump Truck', make: 'Komatsu', equipmentType: 'truck' },
  { id: 'eq-5', model: 'Back Hoe', make: 'Sumitomo', equipmentType: 'backhoe' },
  { id: 'eq-6', model: 'Bulldozer', make: 'CAT', equipmentType: 'bulldozer' },
];
