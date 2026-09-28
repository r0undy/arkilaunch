import { describe, expect, it } from 'vitest';
import { expresswayOf, suggestTolls, tollHintsFromSteps } from './ph-tolls.js';

// OSRM demo, Balintawak to San Fernando, Pampanga (2026-09-28), trimmed.
const steps = [
  { name: 'Epifanio de los Santos Avenue', ref: 'C-4' },
  { name: '', destinations: 'E1' },
  { name: 'North Luzon Expressway', ref: 'E1' },
  { name: '', destinations: 'E1' },
  { name: 'North Luzon Expressway', ref: 'E1' },
  { name: '', destinations: 'San Simon' },
  { name: 'Jose Abad Santos Avenue' },
];

const tolls = [
  { id: 'a', expressway: 'NLEX', entryPoint: 'Balintawak', exitPoint: 'San Fernando' },
  { id: 'b', expressway: 'NLEX', entryPoint: 'Balintawak', exitPoint: 'San Simon' },
  { id: 'c', expressway: 'SLEX', entryPoint: 'Magallanes', exitPoint: 'Sta. Rosa' },
  { id: 'd', expressway: null, entryPoint: null, exitPoint: null },
];

describe('toll suggestions', () => {
  it('maps OSM expressway names to the matrix', () => {
    expect(expresswayOf('North Luzon Expressway E1')).toBe('NLEX');
    expect(expresswayOf('Cavite–Laguna Expressway')).toBe('CALAX');
    expect(expresswayOf('Epifanio de los Santos Avenue')).toBeNull();
  });

  it('reads one stretch per expressway, through its own interchanges', () => {
    expect(tollHintsFromSteps(steps)).toEqual([{ expressway: 'NLEX', entry: 'Epifanio de los Santos Avenue', exit: 'San Simon' }]);
  });

  it('picks the pair the exit sign names, from the Manila-side entry', () => {
    expect(suggestTolls(tollHintsFromSteps(steps), tolls)).toEqual(['b']);
    expect(suggestTolls([{ expressway: 'SLEX', entry: null, exit: 'Santa Rosa; Tagaytay' }], tolls)).toEqual(['c']);
    expect(suggestTolls([{ expressway: 'NLEX', entry: null, exit: 'Somewhere else' }], tolls)).toEqual([]);
  });
});
