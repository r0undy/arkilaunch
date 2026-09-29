import PH_LOCATIONS from '../data/ph-locations.json';

export interface PhLocation {
  region: string;
  province: string;
  city: string;
}

export interface PinAddress {
  street: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  postalCode: string;
}

type NominatimAddress = Partial<Record<string, string>>;

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

// ponytail: public Nominatim (keyless, 1 req/s); a newer pin aborts the pending call. Move to a hosted geocoder if traffic grows.
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
    return null;
  } finally {
    if (inflight.get(key) === controller) inflight.delete(key);
  }
}

export function cancelReverseGeocode(key: string): void {
  inflight.get(key)?.abort();
}

const letters = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
const short = (name: string) => letters(name.toLowerCase().replace(/^city of /, '').replace(/ city$/, ''));

function sameRegion(psgc: string, hint: string): boolean {
  if (!hint) return false;
  if (METRO_MANILA.test(hint)) return psgc.startsWith('NCR');
  return letters(psgc).includes(letters(hint));
}

export function matchPhLocation(address: PinAddress): PhLocation | null {
  if (!short(address.city)) return null;
  const hits: PhLocation[] = [];
  for (const region of PH_LOCATIONS)
    for (const p of region.provinces)
      for (const c of p.cities)
        if (short(c) === short(address.city)) hits.push({ region: region.region, province: p.name, city: c });
  const exact = hits.filter((h) => letters(h.city) === letters(address.city));
  const province = letters(address.province);
  return (
    hits.find((h) => province && letters(h.province) === province) ??
    hits.find((h) => sameRegion(h.region, address.region) || sameRegion(h.region, address.province)) ??
    (exact.length === 1 ? exact[0]! : hits.length === 1 ? hits[0]! : null)
  );
}
