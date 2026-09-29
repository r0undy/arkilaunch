import { Injectable } from '@nestjs/common';
import { events, withTenantTx } from '@arkilaunch/db';
import type { RequestContext } from '@arkilaunch/shared';

// The one emit point, so naming, no-PII properties and the tenant-scoped write are enforced in one place.
@Injectable()
export class EventsService {
  async emit(ctx: RequestContext, name: string, properties: Record<string, unknown> = {}): Promise<void> {
    await withTenantTx(ctx, (tx) => tx.insert(events).values({ tenantId: ctx.tenantId, name, properties }));
  }
}
