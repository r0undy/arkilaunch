import PH_LOCATIONS from '../data/ph-locations.json';
import { Select } from './select.js';
import type { PhLocation } from '../lib/reverse-geocode.js';

// The value is "City, Province": what the route estimate can geocode.
export const EMPTY_LOCATION: PhLocation = { region: '', province: '', city: '' };

export function locationLabel(location: PhLocation): string {
  return location.city ? `${location.city}, ${location.province}` : '';
}

export function LocationPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PhLocation;
  onChange: (next: PhLocation) => void;
}) {
  const region = PH_LOCATIONS.find((r) => r.region === value.region);
  const province = region?.provinces.find((p) => p.name === value.province);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-text">{label}</legend>
      <Select labelHidden
        label={`${label} region`}
        value={value.region}
        onChange={(e) => onChange({ region: e.target.value, province: '', city: '' })}
      >
        <option value="">Region</option>
        {PH_LOCATIONS.map((r) => (
          <option key={r.region}>{r.region}</option>
        ))}
      </Select>
      <Select labelHidden
        label={`${label} province`}
        disabled={!region}
        value={value.province}
        onChange={(e) => onChange({ ...value, province: e.target.value, city: '' })}
      >
        <option value="">Province</option>
        {region?.provinces.map((p) => (
          <option key={p.name}>{p.name}</option>
        ))}
      </Select>
      <Select labelHidden
        label={`${label} city or municipality`}
        disabled={!province}
        value={value.city}
        onChange={(e) => onChange({ ...value, city: e.target.value })}
      >
        <option value="">City / municipality</option>
        {province?.cities.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Select>
    </fieldset>
  );
}
