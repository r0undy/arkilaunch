import { Injectable } from '@nestjs/common';
import { events, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// First-party analytics sink (SDD §1, PRD §5.6). One emit point reused by
// every feature slice instead of each one writing to `events` directly, so
// the naming convention (snake_case object_action, no PII in property
// values) and the tenant-scoped write path are enforced in exactly one
// place.
@Injectable()
export class EventsService {
  async emit(ctx: RequestContext, name: string, properties: Record<string, unknown> = {}): Promise<void> {
    await withTenantTx(ctx, (tx) => tx.insert(events).values({ tenantId: ctx.tenantId, name, properties }));
  }
}
