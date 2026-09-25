import PH_LOCATIONS from '../data/ph-locations.json';
import type { PhLocation } from '../components/location-picker.js';

// What a dropped pin fills in. Every field stays editable: OSM's
// barangay coverage in the Philippines is patchy.
export interface PinAddress {
  street: string;
  barangay: string;
  city: string;
  province: string;
  postalCode: string;
}

type NominatimAddress = Partial<Record<string, string>>;

// Nominatim's addressdetails, mapped to Philippine address parts. A
// barangay shows up as quarter, suburb, village or neighbourhood depending
// on how it was mapped; Metro Manila has no province, only its state.
export function toPinAddress(address: NominatimAddress): PinAddress {
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  return {
    street: street || address.neighbourhood || address.hamlet || '',
    barangay: address.quarter || address.suburb || address.village || address.neighbourhood || '',
    city: address.city || address.town || address.municipality || '',
    province: address.province || address.state || '',
    postalCode: address.postcode ?? '',
  };
}

// ponytail: OSM's public Nominatim (keyless, 1 request/second policy). A
// pin drop or drag is one call and the previous one is aborted; move to a
// hosted geocoder if traffic grows.
let inflight: AbortController | null = null;
export async function reverseGeocode(lat: number, lng: number): Promise<PinAddress | null> {
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
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
    if (inflight === controller) inflight = null;
  }
}

const norm = (name: string) =>
  name.toLowerCase().replace(/^city of /, '').replace(/ city$/, '').replace(/[^a-z]/g, '');

// The PSGC region/province/city the truck form's pickers use, found from a
// geocoded city and province; null when the names do not line up.
export function matchPhLocation(address: PinAddress): PhLocation | null {
  const city = norm(address.city);
  if (!city) return null;
  const province = norm(address.province);
  let fallback: PhLocation | null = null;
  for (const region of PH_LOCATIONS) {
    for (const p of region.provinces) {
      const hit = p.cities.find((c) => norm(c) === city);
      if (!hit) continue;
      const found = { region: region.region, province: p.name, city: hit };
      if (norm(p.name) === province) return found;
      fallback ??= found;
    }
  }
  return fallback;
}
