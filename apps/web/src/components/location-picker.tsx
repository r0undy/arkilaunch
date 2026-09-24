import PH_LOCATIONS from '../data/ph-locations.json';

// Region -> province -> city/municipality, from the PSA PSGC list
// (psgc.gitlab.io, 1,634 cities and municipalities). The value is
// "City, Province": what the route estimate geocodes, so a customer never
// types an address the geocoder cannot find. Street and landmark go in the
// notes instead.
export interface PhLocation {
  region: string;
  province: string;
  city: string;
}

export const EMPTY_LOCATION: PhLocation = { region: '', province: '', city: '' };

export function locationLabel(location: PhLocation): string {
  return location.city ? `${location.city}, ${location.province}` : '';
}

const selectClass =
  'min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text disabled:opacity-50';

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
      <select
        aria-label={`${label} region`}
        className={selectClass}
        value={value.region}
        onChange={(e) => onChange({ region: e.target.value, province: '', city: '' })}
      >
        <option value="">Region</option>
        {PH_LOCATIONS.map((r) => (
          <option key={r.region}>{r.region}</option>
        ))}
      </select>
      <select
        aria-label={`${label} province`}
        className={selectClass}
        disabled={!region}
        value={value.province}
        onChange={(e) => onChange({ ...value, province: e.target.value, city: '' })}
      >
        <option value="">Province</option>
        {region?.provinces.map((p) => (
          <option key={p.name}>{p.name}</option>
        ))}
      </select>
      <select
        aria-label={`${label} city or municipality`}
        className={selectClass}
        disabled={!province}
        value={value.city}
        onChange={(e) => onChange({ ...value, city: e.target.value })}
      >
        <option value="">City / municipality</option>
        {province?.cities.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </fieldset>
  );
}
