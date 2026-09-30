import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

interface ParsedPaymongoSignature {
  timestamp: string | undefined;
  test: string | undefined;
  live: string | undefined;
}

function parsePaymongoSignatureHeader(header: string): ParsedPaymongoSignature {
  const parts: Record<string, string> = {};
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    parts[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { timestamp: parts.t, test: parts.te, live: parts.li };
}

export interface VerifyPaymongoSignatureOptions {
  live?: boolean; // which signature to check: li (live mode, default) or te (test mode)
  toleranceSeconds?: number;
  nowSeconds?: number; // injectable for tests; defaults to the real clock
}

// HMAC-SHA256 of `${t}.${rawBody}`, timing-safe compared against li (live) or te (test); runs BEFORE any body parse.
export function verifyPaymongoSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: VerifyPaymongoSignatureOptions = {},
): boolean {
  const { timestamp, test, live } = parsePaymongoSignatureHeader(signatureHeader);
  const provided = (options.live ?? true) ? live : test;
  if (!timestamp || !provided) return false;

  const timestampNum = Number(timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > tolerance) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
