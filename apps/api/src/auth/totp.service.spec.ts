import { describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import { TotpService } from './totp.service.js';

describe('TotpService', () => {
  it('a code generated from a secret verifies against that same secret', async () => {
    const totp = new TotpService();
    const secret = totp.generateSecret();
    const code = await generate({ secret });
    await expect(totp.verify(code, secret)).resolves.toBe(true);
  });

  it('rejects a code generated from a different secret', async () => {
    const totp = new TotpService();
    const secretA = totp.generateSecret();
    const secretB = totp.generateSecret();
    const codeForB = await generate({ secret: secretB });
    await expect(totp.verify(codeForB, secretA)).resolves.toBe(false);
  });

  it('fails closed on a malformed secret instead of throwing', async () => {
    const totp = new TotpService();
    await expect(totp.verify('123456', 'not-a-valid-base32-secret-!!!')).resolves.toBe(false);
  });

  it('keyUri produces an otpauth:// URI carrying the account label and issuer', () => {
    const totp = new TotpService();
    const secret = totp.generateSecret();
    const uri = totp.keyUri('timekeeper@example.test', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('ArkiLaunch');
  });
});
