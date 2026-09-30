import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';

// Known gap: the base32 secret is stored plaintext in users.totp_secret; encrypt at rest before production.
@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  keyUri(accountLabel: string, secret: string): string {
    return generateURI({ issuer: 'ArkiLaunch', label: accountLabel, secret });
  }

  async verify(code: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({ secret, token: code });
      return result.valid;
    } catch {
      return false; // malformed secret/token -- fail closed, never throw into a 500
    }
  }
}
