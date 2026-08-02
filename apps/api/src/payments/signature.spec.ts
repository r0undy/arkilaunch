import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyPaymongoSignature } from './signature.js';

// PayMongo Paymongo-Signature scheme (QAD-T28: verified before body parse).
// Pure/offline: no DB, no live PayMongo call.
describe('verifyPaymongoSignature', () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ data: { id: 'evt_123' } });

  function sign(timestamp: number, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  it('accepts a correctly signed live-mode header', () => {
    const now = Math.floor(Date.now() / 1000);
    const liveSig = sign(now, rawBody);
    const header = `t=${now},te=deadbeef,li=${liveSig}`;
    expect(verifyPaymongoSignature(rawBody, header, secret, { nowSeconds: now })).toBe(true);
  });

  it('accepts a correctly signed test-mode header when live:false is requested', () => {
    const now = Math.floor(Date.now() / 1000);
    const testSig = sign(now, rawBody);
    const header = `t=${now},te=${testSig},li=deadbeef`;
    expect(verifyPaymongoSignature(rawBody, header, secret, { live: false, nowSeconds: now })).toBe(true);
  });

  it('QAD-T28: rejects a tampered body even with a valid-looking signature', () => {
    const now = Math.floor(Date.now() / 1000);
    const liveSig = sign(now, rawBody);
    const header = `t=${now},te=deadbeef,li=${liveSig}`;
    const tamperedBody = JSON.stringify({ data: { id: 'evt_999' } });
    expect(verifyPaymongoSignature(tamperedBody, header, secret, { nowSeconds: now })).toBe(false);
  });

  it('QAD-T28: rejects a forged signature computed with the wrong secret', () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = createHmac('sha256', 'wrong-secret').update(`${now}.${rawBody}`).digest('hex');
    const header = `t=${now},te=deadbeef,li=${forged}`;
    expect(verifyPaymongoSignature(rawBody, header, secret, { nowSeconds: now })).toBe(false);
  });

  it('rejects a stale timestamp outside the tolerance window (replay defense)', () => {
    const now = Math.floor(Date.now() / 1000);
    const staleTimestamp = now - 3600;
    const liveSig = sign(staleTimestamp, rawBody);
    const header = `t=${staleTimestamp},te=deadbeef,li=${liveSig}`;
    expect(verifyPaymongoSignature(rawBody, header, secret, { nowSeconds: now })).toBe(false);
  });

  it('rejects a malformed header with no li/te component', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyPaymongoSignature(rawBody, `t=${now}`, secret, { nowSeconds: now })).toBe(false);
  });
});
