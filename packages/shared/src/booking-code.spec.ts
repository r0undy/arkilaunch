import { describe, expect, it } from 'vitest';
import {
  BookingCodeSchema,
  bookingCodeSearchPrefix,
  formatBookingCode,
  isBookingCode,
  parseBookingCode,
} from './booking-code.js';

describe('booking codes', () => {
  it('formats both services the same way', () => {
    expect(formatBookingCode('rental', 2026, 1)).toBe('EQR-2026-0001');
    expect(formatBookingCode('truck', 2026, 1)).toBe('TRK-2026-0001');
  });

  it('pads to four digits and never truncates past 9999 (matches SQL booking_code_format)', () => {
    expect(formatBookingCode('rental', 2026, 9999)).toBe('EQR-2026-9999');
    expect(formatBookingCode('rental', 2026, 12345)).toBe('EQR-2026-12345');
  });

  it('round-trips', () => {
    for (const [service, year, n] of [['rental', 2025, 7], ['truck', 2031, 10001]] as const) {
      expect(parseBookingCode(formatBookingCode(service, year, n))).toEqual({ service, year, n });
    }
  });

  it('parses case-insensitively and rejects anything else', () => {
    expect(parseBookingCode(' eqr-2026-0042 ')).toEqual({ service: 'rental', year: 2026, n: 42 });
    for (const bad of ['BKG-F320', 'RNT-2026-0001', 'EQR-26-0001', 'EQR-2026-001', 'EQR-2026-0001x', '']) {
      expect(isBookingCode(bad)).toBe(false);
    }
    expect(BookingCodeSchema.safeParse('TRK-2026-0003').success).toBe(true);
    expect(BookingCodeSchema.safeParse('TRK-2026-3').success).toBe(false);
  });

  it('rejects impossible inputs instead of printing a malformed code', () => {
    expect(() => formatBookingCode('rental', 2026, 0)).toThrow();
    expect(() => formatBookingCode('rental', 26, 1)).toThrow();
    expect(() => formatBookingCode('truck', 2026, 1.5)).toThrow();
  });

  it('turns a search box value into a code prefix only when it can be one', () => {
    expect(bookingCodeSearchPrefix('eqr-2026-00')).toBe('EQR-2026-00');
    expect(bookingCodeSearchPrefix('TRK')).toBe('TRK');
    expect(bookingCodeSearchPrefix('excavator')).toBeNull();
    expect(bookingCodeSearchPrefix('   ')).toBeNull();
  });
});
