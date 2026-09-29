import PH_LOCATIONS from '../data/ph-locations.json';
import type { PhLocation } from '../components/location-picker.js';

// What a dropped pin fills in. Every field stays editable: OSM's
// barangay coverage in the Philippines is patchy.
export interface PinAddress {
  street: string;
  barangay: string;
  city: string;
  province: string;
  // The region, only used to tell same-named cities apart (8 San Juans).
  region: string;
  postalCode: string;
}

type NominatimAddress = Partial<Record<string, string>>;

// Nominatim's addressdetails, mapped to Philippine address parts. A
// barangay shows up as quarter, suburb, village or neighbourhood depending
// on how it was mapped. Metro Manila has no province: Nominatim puts it
// under `region` (sometimes `state`), and it is the NCR's one "province".
const METRO_MANILA = /metro manila|national capital/i;
export function toPinAddress(address: NominatimAddress): PinAddress {
  const region = address.region || address.state || '';
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  return {
    street: street || address.neighbourhood || address.hamlet || '',
    barangay: address.quarter || address.suburb || address.village || address.neighbourhood || '',
    city: address.city || address.town || address.municipality || '',
    province: address.province || (METRO_MANILA.test(region) ? 'Metro Manila' : address.state) || '',
    region,
    postalCode: address.postcode ?? '',
  };
}

// ponytail: OSM's public Nominatim (keyless, 1 request/second policy). A
// pin drop or drag is one call and the previous one for the same `key` (the
// pickup or the drop-off) is aborted; move to a hosted geocoder if traffic
// grows.
const inflight = new Map<string, AbortController>();
export async function reverseGeocode(lat: number, lng: number, key = 'pin'): Promise<PinAddress | null> {
  inflight.get(key)?.abort();
  const controller = new AbortController();
  inflight.set(key, controller);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: NominatimAddress };
    return body.address ? toPinAddress(body.address) : null;
  } catch {
    // Offline, aborted by a newer pin, or rate-limited: the fields stay as typed.
    return null;
  } finally {
    if (inflight.get(key) === controller) inflight.delete(key);
  }
}

// Drops the pending lookup for `key`, so it cannot overwrite what replaced the pin.
export function cancelReverseGeocode(key: string): void {
  inflight.get(key)?.abort();
}

const letters = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
const short = (name: string) => letters(name.toLowerCase().replace(/^city of /, '').replace(/ city$/, ''));

// Is the PSGC region the one Nominatim named ("Metro Manila" is the NCR,
// "Calabarzon" is "CALABARZON (Region IV-A)")?
function sameRegion(psgc: string, hint: string): boolean {
  if (!hint) return false;
  if (METRO_MANILA.test(hint)) return psgc.startsWith('NCR');
  return letters(psgc).includes(letters(hint));
}

// The PSGC region/province/city the truck form's pickers use, found from a
// geocoded city, province and region. A name shared by several places
// ("San Juan", "Quezon" vs "Quezon City") resolves by province, then by
// region; still ambiguous, it is null rather than a guess.
export function matchPhLocation(address: PinAddress): PhLocation | null {
  if (!short(address.city)) return null;
  const hits: PhLocation[] = [];
  for (const region of PH_LOCATIONS)
    for (const p of region.provinces)
      for (const c of p.cities)
        if (short(c) === short(address.city)) hits.push({ region: region.region, province: p.name, city: c });
  // With no province or region to go on, "Quezon City" still means the
  // one place of that full name, not the town of Quezon, Isabela.
  const exact = hits.filter((h) => letters(h.city) === letters(address.city));
  const province = letters(address.province);
  return (
    hits.find((h) => province && letters(h.province) === province) ??
    hits.find((h) => sameRegion(h.region, address.region) || sameRegion(h.region, address.province)) ??
    (exact.length === 1 ? exact[0]! : hits.length === 1 ? hits[0]! : null)
  );
}
