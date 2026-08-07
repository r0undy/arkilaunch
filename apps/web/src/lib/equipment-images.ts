// Documentary photos for the seeded anchor-tenant fleet (see
// packages/db/src/seed/anchor.ts) -- everything else still falls back to
// EquipmentSchematic's flat two-colour glyph (equipment-schematic.tsx).
const EQUIPMENT_IMAGE_BY_MODEL: Record<string, string> = {
  'Almara Backhoe #1': 'https://tse4.mm.bing.net/th/id/OIP.B5DfVLWIpejgrKceADP-8QHaE8?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
  'JCB 3CX':
    'https://th.bing.com/th/id/R.9e7409ede2d2111fa6165c55494d0074?rik=JqYWmkD6cMEIvg&riu=http%3a%2f%2fdewhurstagri.com%2fwp-content%2fuploads%2f2023%2f05%2f4A4F126C-8381-4A14-84ED-A42DEF7D7793-scaled.jpeg&ehk=mMrGluifNkLqrPlpqtaj6z9EH0F3lLFkJClNOq%2fPUic%3d&risl=&pid=ImgRaw&r=0',
  'Case 580N': 'https://www.lubyequipment.com/wp-content/uploads/2024/06/2023-case-580sn-backhoe-loader.webp',
};

export function equipmentImageUrl(model: string): string | undefined {
  return EQUIPMENT_IMAGE_BY_MODEL[model];
}
