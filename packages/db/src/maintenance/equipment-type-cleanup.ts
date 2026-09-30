export type EquipmentType = { id: string; name: string };
export type QuotationTypeReference = {
  equipment_type_id: string | null;
  rate_card_id: string | null;
};

// Only fixture names created by money-path.spec, rate-cards.spec, and billing-engine.spec.
export function isFixtureEquipmentType(name: string): boolean {
  return /^(?:Money Path Cap Fixture(?: \d{13})?|(?:Rate Card Test Type|Daily Only Type) \d{13})$/.test(
    name,
  );
}

export function planEquipmentTypeCleanup(
  types: EquipmentType[],
  rates: { id: string; equipment_type_id: string }[],
  quotationItems: QuotationTypeReference[],
): { typeIds: string[]; rateIds: string[]; fallbackId: string | null } {
  const typeIds = types.filter((type) => isFixtureEquipmentType(type.name)).map((type) => type.id);
  if (typeIds.length === 0) return { typeIds, rateIds: [], fallbackId: null };
  const ids = new Set(typeIds);
  const rateIds = rates.filter((rate) => ids.has(rate.equipment_type_id)).map((rate) => rate.id);
  const rateSet = new Set(rateIds);
  if (
    quotationItems.some(
      (item) =>
        (item.equipment_type_id !== null && ids.has(item.equipment_type_id)) ||
        (item.rate_card_id !== null && rateSet.has(item.rate_card_id)),
    )
  )
    throw new Error(
      'Fixture categories or rate cards are referenced by historical quotes; cleanup refused',
    );
  const fallback = types.filter((type) => type.name === 'Others');
  if (fallback.length !== 1)
    throw new Error('Exactly one existing Others category is required; cleanup refused');
  return { typeIds, rateIds, fallbackId: fallback[0]!.id };
}
