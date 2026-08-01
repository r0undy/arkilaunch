import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';

// PRD US-02/US-07: timekeeper 2FA. `otplib` v13's functional API implements
// RFC 6238 TOTP (verified against the installed package's own .d.ts, not
// from memory -- v13 is a full rewrite of the older `authenticator` class
// API, per AGENTS.md §3 "verify against current docs before writing
// framework code"). We do not hand-roll HOTP/TOTP math ourselves.
// NOTE (known gap, flagged rather than silently deviating from the SDD §3
// comment on users.totp_secret "encrypted at rest"): this pass stores the
// base32 secret as plaintext in that column, matching the schema shipped
// today. Column-level encryption is a follow-up before production, not
// implemented here to avoid inventing a homegrown crypto scheme under this
// pass's scope.
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
