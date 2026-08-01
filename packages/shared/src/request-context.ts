import { z } from 'zod';

// The per-request tenant/user/role triple that every DB access runs under
// (packages/db withTenantTx sets these as Postgres GUCs). Derived from the
// verified JWT server-side; never accepted from a client payload.
export const RequestContextSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;
