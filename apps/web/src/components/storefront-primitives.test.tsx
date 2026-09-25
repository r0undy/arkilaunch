import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EquipmentCard } from './equipment-card.js';
import { SearchFilterBar } from './search-filter-bar.js';

describe('EquipmentCard', () => {
  it('renders model, make, and a Rent action', () => {
    const html = renderToStaticMarkup(<EquipmentCard imageAlt="Back Hoe" model="Back Hoe" make="CAT" onRent={() => {}} />);
    expect(html).toContain('Back Hoe');
    expect(html).toContain('CAT');
    expect(html).toContain('Rent');
  });
});

describe('SearchFilterBar', () => {
  it('offers search and no availability labels', () => {
    const html = renderToStaticMarkup(<SearchFilterBar query="" onQueryChange={vi.fn()} />);
    expect(html).toContain('Search equipment');
    expect(html).not.toMatch(/Deployed|maintenance/i);
  });
});

describe('EquipmentCard unavailable', () => {
  it('disables Rent and shows no status label', () => {
    const html = renderToStaticMarkup(
      <EquipmentCard imageAlt="x" model="Back Hoe" make="CAT" unavailable onRent={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Rent/);
    expect(html).not.toMatch(/Deployed|maintenance|Available/i);
  });
});
