// Documentary photos for the seeded anchor-tenant fleet (see
// packages/db/src/seed/anchor.ts) -- everything else still falls back to
// EquipmentSchematic's flat two-colour glyph (equipment-schematic.tsx).
//
// This is the FALLBACK, not the source. A machine's real uploaded photo is
// equipment.photo_uri, served by the catalog since migration 0028; callers
// read `photoUri ?? equipmentImageUrl(model)`. Until then nothing rendered an
// uploaded photo anywhere, so the equipment CRUD upload had no visible effect
// on the storefront.
//
// The Almara catalog entries (cr-arkilaunch-equipment-options.md) are
// manufacturer, dealer and listing reference photos, used with the owner's
// authorization. Each one's credit and source page is on the equipment row
// (photo_credit, photo_source_url, migration 0065) and shown under the photo.
const EQUIPMENT_IMAGE_BY_MODEL: Record<string, string> = {
  'Almara Backhoe #1': 'https://tse4.mm.bing.net/th/id/OIP.B5DfVLWIpejgrKceADP-8QHaE8?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
  'JCB 3CX':
    'https://th.bing.com/th/id/R.9e7409ede2d2111fa6165c55494d0074?rik=JqYWmkD6cMEIvg&riu=http%3a%2f%2fdewhurstagri.com%2fwp-content%2fuploads%2f2023%2f05%2f4A4F126C-8381-4A14-84ED-A42DEF7D7793-scaled.jpeg&ehk=mMrGluifNkLqrPlpqtaj6z9EH0F3lLFkJClNOq%2fPUic%3d&risl=&pid=ImgRaw&r=0',
  'Case 580N': 'https://www.lubyequipment.com/wp-content/uploads/2024/06/2023-case-580sn-backhoe-loader.webp',
  'Mitsubishi MS90': 'https://static.truck2hand.com/public/upload/item/4802/124b3359-4a2f-47a3-aa3d-56523c849099.jpeg',
  'Mitsubishi MS70': 'https://d9z1tpn605xsl.cloudfront.net/uploads/gallery/image/22355164/middle_MS070-8__3_.jpg',
  'Sumitomo Excavator': 'https://sumitomo-vn.com/uploads/17/ark1695359157.jpg',
  'Bulldozer (Pison), 10 tons':
    'https://www.komatsu.com/content/dam/komatsu/photos-images/kx-jpegs/811118_Dozer_D39EX_MG_literature-link_2091_msA-1280x1280.jpeg',
  'Dump Truck, Standard': 'https://pinoydeal.ph/oc-content/uploads/775/139760.jpg',
};

export function equipmentImageUrl(model: string): string | undefined {
  return EQUIPMENT_IMAGE_BY_MODEL[model];
}
