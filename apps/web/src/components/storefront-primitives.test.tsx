import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FeatureTile } from './feature-tile.js';
import { ProofPill } from './proof-pill.js';
import { PackageCard } from './package-card.js';
import { EquipmentCard } from './equipment-card.js';
import { SearchFilterBar } from './search-filter-bar.js';
import { RiseIn } from './rise-in.js';

describe('FeatureTile', () => {
  it('renders title and description', () => {
    const html = renderToStaticMarkup(<FeatureTile icon={<span />} title="Scan the paper" description="OCR reads it" />);
    expect(html).toContain('Scan the paper');
    expect(html).toContain('OCR reads it');
  });
});

describe('ProofPill', () => {
  it('renders numeral and unit separately, never combined amber-on-white', () => {
    const html = renderToStaticMarkup(<ProofPill value="20-30" unit="min by hand" />);
    expect(html).toContain('20-30');
    expect(html).toContain('min by hand');
    expect(html).toContain('text-primary-ink');
  });
});

describe('PackageCard', () => {
  it('renders featured variant with inverse text', () => {
    const html = renderToStaticMarkup(<PackageCard name="Growth" price="₱9,000/mo" features={['Weather module']} featured />);
    expect(html).toContain('Growth');
    expect(html).toContain('text-inverse');
  });
});

describe('EquipmentCard', () => {
  it('renders model, make, and a Rent action', () => {
    const html = renderToStaticMarkup(<EquipmentCard imageAlt="Back Hoe" model="Back Hoe" make="CAT" onRent={() => {}} />);
    expect(html).toContain('Back Hoe');
    expect(html).toContain('CAT');
    expect(html).toContain('Rent');
  });
});

describe('SearchFilterBar', () => {
  it('marks the active availability filter', () => {
    const html = renderToStaticMarkup(
      <SearchFilterBar query="" onQueryChange={vi.fn()} availability="available" onAvailabilityChange={vi.fn()} />,
    );
    expect(html).toContain('Available');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Available|Available[^<]*<\/button>/);
  });
});

describe('RiseIn', () => {
  it('starts hidden before intersection observer fires', () => {
    const html = renderToStaticMarkup(
      <RiseIn>
        <p>Reveal me</p>
      </RiseIn>,
    );
    expect(html).toContain('Reveal me');
    expect(html).toContain('opacity-0');
  });
});
