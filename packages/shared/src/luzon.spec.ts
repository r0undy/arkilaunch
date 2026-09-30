import { describe, expect, it } from 'vitest';
import { onLuzonMainland } from './luzon.js';

describe('Luzon mainland service area', () => {
  it('includes mainland cities from north to south', () => {
    expect(onLuzonMainland(14.5995, 120.9842)).toBe(true); // Manila
    expect(onLuzonMainland(16.4023, 120.596)).toBe(true); // Baguio
    expect(onLuzonMainland(13.1391, 123.7438)).toBe(true); // Legazpi
  });

  it('excludes other islands, sea, and non-Philippine coordinates', () => {
    expect(onLuzonMainland(13.3667, 121.05)).toBe(false); // Mindoro
    expect(onLuzonMainland(14.0, 124.2)).toBe(false); // sea
    expect(onLuzonMainland(10.3157, 123.8854)).toBe(false); // Cebu
    expect(onLuzonMainland(25.0, 121.5)).toBe(false); // Taiwan
  });
});
