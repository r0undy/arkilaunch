import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

export const TURNSTILE_HEADER = 'x-turnstile-token';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// On, it refuses to boot without the secret.
if (process.env.TURNSTILE_ENABLED === 'true' && !process.env.TURNSTILE_SECRET_KEY) {
  throw new Error('TURNSTILE_ENABLED=true requires TURNSTILE_SECRET_KEY');
}

// Fails closed: a bot must not get past by making siteverify time out.
export async function verifyTurnstile(token: string | undefined, ip: string | undefined): Promise<void> {
  if (process.env.TURNSTILE_ENABLED !== 'true') return;
  if (!token) throw new ForbiddenException({ error: 'captcha_required' });

  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set('remoteip', ip);
  let result: { success?: boolean };
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = (await res.json()) as { success?: boolean };
  } catch {
    throw new ServiceUnavailableException({ error: 'captcha_unavailable' });
  }
  if (result.success !== true) throw new ForbiddenException({ error: 'captcha_failed' });
}

@Injectable()
export class TurnstileGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; ip?: string }>();
    await verifyTurnstile(req.headers[TURNSTILE_HEADER], req.ip);
    return true;
  }
}
