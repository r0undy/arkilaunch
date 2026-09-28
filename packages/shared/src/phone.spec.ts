import { describe, expect, it } from 'vitest';
import { localPhMobile, normalizePhMobile, PhMobileSchema } from './phone.js';

describe('PH mobile', () => {
  it('normalizes every usual way of writing it', () => {
    for (const raw of ['09171234567', '639171234567', '+63 917 123 4567', '917-123-4567', '+639171234567']) {
      expect(normalizePhMobile(raw)).toBe('+639171234567');
    }
  });
  it('refuses landlines, short numbers and junk', () => {
    for (const raw of ['0281234567', '917123456', '+6381234567890', '', 'abc']) {
      expect(PhMobileSchema.safeParse(raw).success).toBe(false);
    }
    expect(PhMobileSchema.parse('0917 123 4567')).toBe('+639171234567');
  });
  it('splits a stored number back for the +63 input', () => {
    expect(localPhMobile('+639171234567')).toBe('917 123 4567');
    expect(localPhMobile('02 8123 4567')).toBe('');
    expect(localPhMobile(null)).toBe('');
  });
});
