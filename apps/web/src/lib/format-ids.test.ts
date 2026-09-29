import { describe, expect, it } from 'vitest';
import { condenseIds } from './format.js';

// Short codes must keep traceability and must not mangle prose that merely looks id-shaped.
describe('condenseIds', () => {
  it('shortens every uuid in a server-written description, keeping the prose', () => {
    const input =
      'EDTR reconciliation 90aa8b0a-2b49-4b88-aced-7d700e3633c0 (sources: 7a2a8af6-bf9c-41a0-9af4-d751b99d961c, 680d7442-dd18-44b5-907f-6d97b40a8bac)';
    expect(condenseIds(input)).toBe(
      'EDTR reconciliation REC-90AA (sources: REC-7A2A, REC-680D)',
    );
  });

  it('leaves text with no uuid untouched', () => {
    expect(condenseIds('Flat rate delivery to Zone B')).toBe('Flat rate delivery to Zone B');
  });

  it('does not chew through hyphenated words or partial ids', () => {
    expect(condenseIds('re-invoiced 1234-5678 for site B-12')).toBe(
      're-invoiced 1234-5678 for site B-12',
    );
  });
});
