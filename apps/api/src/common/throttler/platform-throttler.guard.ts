import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Default ThrottlerGuard.getTracker() returns req.ip, which behind
// Cloudflare (BUILD §3) is Cloudflare's edge IP -- so every client shares
// one throttle bucket unless main.ts's `trust proxy` setting AND this
// override are both in place. Cloudflare sets CF-Connecting-IP at the edge
// and strips any client-supplied copy of that header, so it is safe to
// trust; fall back to req.ip (now populated from X-Forwarded-For thanks to
// `trust proxy`) for local dev / anything not behind Cloudflare.
@Injectable()
export class PlatformThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const cfConnectingIp = req['headers']
      ? (req['headers'] as Record<string, string | string[] | undefined>)['cf-connecting-ip']
      : undefined;
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.length > 0) {
      return cfConnectingIp;
    }
    return (req['ip'] as string | undefined) ?? 'unknown';
  }
}
