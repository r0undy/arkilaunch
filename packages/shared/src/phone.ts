import { z } from 'zod';

export const PH_MOBILE_REGEX = /^\+639\d{9}$/;

export function normalizePhMobile(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return `+63${digits}`;
}

export function localPhMobile(value: string | null | undefined): string {
  if (!value) return '';
  const e164 = normalizePhMobile(value);
  if (!PH_MOBILE_REGEX.test(e164)) return '';
  const d = e164.slice(3);
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export const PhMobileSchema = z
  .string()
  .trim()
  .transform(normalizePhMobile)
  .refine((v) => PH_MOBILE_REGEX.test(v), 'Enter a PH mobile number, e.g. +63 917 123 4567');
