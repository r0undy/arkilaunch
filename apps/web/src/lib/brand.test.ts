import { describe, expect, it } from 'vitest';
import { brandVars, onPrimaryFor, pageTitle } from './brand.js';

describe('onPrimaryFor', () => {
  it('picks the higher-contrast text color', () => {
    expect(onPrimaryFor('#f2a100')).toBe('#000000'); // amber: dark text (DSD §2.1)
    expect(onPrimaryFor('#1e5f8c')).toBe('#ffffff'); // dispatch blue: white text
    expect(onPrimaryFor('#5ec2c2')).toBe('#000000'); // Almara teal: white would be 2.1:1
    expect(onPrimaryFor('#a23e01')).toBe('#ffffff'); // Almara rust bar
    expect(onPrimaryFor('#ffffff')).toBe('#000000');
    expect(onPrimaryFor('#000000')).toBe('#ffffff');
  });
});

describe('brandVars', () => {
  it('sets nothing for the ArkiLaunch defaults', () => {
    expect(brandVars({ primaryColor: null, font: null })).toEqual({});
    expect(brandVars(undefined)).toEqual({});
  });

  it('paints the primary with its hover and text color', () => {
    expect(brandVars({ primaryColor: '#5ec2c2', font: null })).toEqual({
      '--yb-color-primary': '#5ec2c2',
      '--yb-color-primary-hover': 'color-mix(in srgb, #5ec2c2 85%, black)',
      '--yb-color-on-primary': '#000000',
    });
  });

  it('swaps prose and display to Inter, never mono', () => {
    const vars = brandVars({ primaryColor: null, font: 'inter' });
    expect(vars['--font-sans']).toMatch(/^'Inter'/);
    expect(vars['--font-display']).toBe(vars['--font-sans']);
    expect(Object.keys(vars)).not.toContain('--font-mono');
  });
});

describe('pageTitle', () => {
  it('titles storefront pages after their heading', () => {
    expect(pageTitle('/', 'Almara Construction')).toBe('Almara Construction');
    expect(pageTitle('/equipment', 'Almara Construction')).toBe('Equipment for hire | Almara Construction');
    expect(pageTitle('/contact/', 'Almara Construction')).toBe('Contact | Almara Construction');
    expect(pageTitle('/app/branding', 'Almara Construction')).toBe('Almara Construction');
  });

  it('leaves an equipment page to title itself with its model', () => {
    expect(pageTitle('/equipment/abc', 'Almara Construction')).toBeNull();
    expect(pageTitle('/equipment/abc', 'Almara Construction', 'CAT D6R')).toBe('CAT D6R | Almara Construction');
  });
});
