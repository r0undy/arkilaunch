import { describe, expect, it } from 'vitest';
import {
  DTI_REGEX,
  idTypeOf,
  PH_ID_TYPES,
  validIdNumber,
  matchBand,
  normalizePcn,
  normalizeSecNumber,
  normalizeTin,
  sameTin,
  PHILSYS_PCN_REGEX,
  SEC_REGEX,
  TIN_REGEX,
} from './kyc.js';

describe('matchBand (RFC-2 §3 fuzzy-match banding)', () => {
  it('bands below 0.85 as a mismatch', () => {
    expect(matchBand(0.5)).toBe('mismatch');
    expect(matchBand(0.849)).toBe('mismatch');
  });

  it('bands 0.85-0.90 as confirm_manually', () => {
    expect(matchBand(0.85)).toBe('confirm_manually');
    expect(matchBand(0.899)).toBe('confirm_manually');
  });

  it('bands 0.90 and above as strong', () => {
    expect(matchBand(0.9)).toBe('strong');
    expect(matchBand(1)).toBe('strong');
  });
});

describe('TIN_REGEX / SEC_REGEX (RFC-2 §3 format checks)', () => {
  it('accepts a well-formed TIN with and without the branch suffix', () => {
    expect(TIN_REGEX.test('123-456-789')).toBe(true);
    expect(TIN_REGEX.test('123-456-789-001')).toBe(true);
  });

  it('rejects a malformed TIN', () => {
    expect(TIN_REGEX.test('not-a-tin')).toBe(false);
    expect(TIN_REGEX.test('123456789')).toBe(false);
  });

  it('accepts the SEC registration number shapes in circulation', () => {
    for (const sec of ['CS202312345', 'A199812345', 'AS094-008814', 'PG201900123', '2021060012345-00', '2021060012345'])
      expect(SEC_REGEX.test(sec), sec).toBe(true);
  });

  it('rejects an implausible SEC registration number', () => {
    expect(SEC_REGEX.test('a')).toBe(false);
    expect(SEC_REGEX.test('<script>alert(1)</script>')).toBe(false);
    // A TIN or a DTI number is not an SEC number.
    expect(SEC_REGEX.test('123-456-789-000')).toBe(false);
    expect(SEC_REGEX.test('1234567')).toBe(false);
  });
});

describe('DTI_REGEX / PHILSYS_PCN_REGEX', () => {
  it('accepts a DTI business name number, with or without the BN prefix', () => {
    for (const dti of ['1234567', '3456789012', 'BN-1234567', 'bn1234567']) expect(DTI_REGEX.test(dti), dti).toBe(true);
    for (const dti of ['12345', 'CS202312345', '123-456-789']) expect(DTI_REGEX.test(dti), dti).toBe(false);
  });

  it('accepts a dashed 16-digit PCN only', () => {
    expect(PHILSYS_PCN_REGEX.test('1234-5678-9012-3456')).toBe(true);
    expect(PHILSYS_PCN_REGEX.test('1234567890123456')).toBe(false);
    expect(PHILSYS_PCN_REGEX.test('1234-5678-9012')).toBe(false);
  });
});

describe('normalizeTin / normalizePcn', () => {
  it('re-dashes spaced or undashed digits into the canonical groups', () => {
    expect(normalizeTin('123 456 789')).toBe('123-456-789');
    expect(normalizeTin('123456789000')).toBe('123-456-789-000');
    expect(normalizePcn('1234 5678 9012 3456')).toBe('1234-5678-9012-3456');
  });

  it('leaves a wrong digit count alone so the format check still reports it', () => {
    expect(normalizeTin(' 12-34 ')).toBe('12-34');
    expect(TIN_REGEX.test(normalizeTin('1234567890'))).toBe(false);
    expect(normalizePcn('1234')).toBe('1234');
  });
});

describe('5-digit branch codes, sameTin, normalizeSecNumber', () => {
  it('accepts and regroups a 14-digit TIN', () => {
    expect(TIN_REGEX.test('123-456-789-00000')).toBe(true);
    expect(normalizeTin('12345678900000')).toBe('123-456-789-00000');
    expect(TIN_REGEX.test('123-456-789-0000')).toBe(false);
  });

  it('treats a missing branch as the head office', () => {
    expect(sameTin('123-456-789', '123-456-789-000')).toBe(true);
    expect(sameTin('123-456-789-000', '123456789 00000')).toBe(true);
    expect(sameTin('123-456-789-001', '123-456-789-000')).toBe(false);
    expect(sameTin('123-456-780', '123-456-789')).toBe(false);
  });

  it('removes the spaces OCR and people put in an SEC number', () => {
    expect(normalizeSecNumber(' cs 2019 12345 ')).toBe('CS201912345');
    expect(normalizeSecNumber('2022090068683 - 02')).toBe('2022090068683-02');
  });
});

describe('Philippine primary IDs (QA 15)', () => {
  it('checks each card number in its own format, however it was typed', () => {
    expect(validIdNumber('philsys', '1234 5678 9012 3456')).toBe(true);
    expect(validIdNumber('passport', 'p1234567a')).toBe(true);
    expect(validIdNumber('drivers_license', 'A0123456789')).toBe(true);
    expect(PH_ID_TYPES.drivers_license.normalize('a01 23 456789')).toBe('A01-23-456789');
    expect(validIdNumber('umid', '011112345678')).toBe(true);
    expect(validIdNumber('sss', '34 1234567 8')).toBe(true);
    expect(validIdNumber('prc', '0123456')).toBe(true);
    expect(validIdNumber('tin_id', '123456789')).toBe(true);
  });

  it('refuses a number in another card format', () => {
    expect(validIdNumber('philsys', 'P1234567A')).toBe(false);
    expect(validIdNumber('passport', '1234-5678-9012-3456')).toBe(false);
    expect(validIdNumber('sss', '12345')).toBe(false);
  });

  it('reads an untyped (pre-QA 15) upload as PhilSys', () => {
    expect(idTypeOf(undefined)).toBe('philsys');
    expect(idTypeOf('nonsense')).toBe('philsys');
    expect(idTypeOf('passport')).toBe('passport');
  });
});
