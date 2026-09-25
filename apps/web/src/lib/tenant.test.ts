import { describe, expect, it } from 'vitest';
import { onPrimaryFor } from './tenant.js';

describe('onPrimaryFor', () => {
  it('picks the higher-contrast text color', () => {
    expect(onPrimaryFor('#f2a100')).toBe('#000000'); // amber: dark text (DSD §2.1)
    expect(onPrimaryFor('#1e5f8c')).toBe('#ffffff'); // dispatch blue: white text
    expect(onPrimaryFor('#ffffff')).toBe('#000000');
    expect(onPrimaryFor('#000000')).toBe('#ffffff');
  });
});
