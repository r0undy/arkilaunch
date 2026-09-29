import { z } from 'zod';

// The database assigns codes (migration 0058); this module must agree with that SQL exactly.

export const BOOKING_SERVICES = ['rental', 'truck'] as const;
export type BookingService = (typeof BOOKING_SERVICES)[number];

export const BOOKING_CODE_PREFIX: Record<BookingService, string> = { rental: 'EQR', truck: 'TRK' };

export const BOOKING_SERVICE_LABEL: Record<BookingService, string> = {
  rental: 'Equipment rental',
  truck: 'Truck service',
};

const CODE_RE = /^(EQR|TRK)-(\d{4})-(\d{4,})$/;

export const BookingCodeSchema = z.string().regex(CODE_RE, 'Not a booking code (EQR-YYYY-NNNN or TRK-YYYY-NNNN)');

// Mirror of SQL booking_code_format: zero-padded to four digits, never truncated.
export function formatBookingCode(service: BookingService, year: number, n: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`bad year ${year}`);
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`bad sequence ${n}`);
  return `${BOOKING_CODE_PREFIX[service]}-${year}-${String(n).padStart(4, '0')}`;
}

export interface ParsedBookingCode {
  service: BookingService;
  year: number;
  n: number;
}

export function parseBookingCode(code: string): ParsedBookingCode | null {
  const m = CODE_RE.exec(code.trim().toUpperCase());
  if (!m) return null;
  return { service: m[1] === 'EQR' ? 'rental' : 'truck', year: Number(m[2]), n: Number(m[3]) };
}

export function isBookingCode(value: string): boolean {
  return parseBookingCode(value) !== null;
}

export function bookingCodeSearchPrefix(q: string): string | null {
  const v = q.trim().toUpperCase();
  if (!v) return null;
  return /^(E|EQ|EQR|T|TR|TRK)(-\d{0,4}(-\d*)?)?$/.test(v) ? v : null;
}
