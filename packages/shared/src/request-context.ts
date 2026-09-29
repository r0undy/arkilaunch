import { z } from 'zod';

// Derived from the verified JWT server-side; never accepted from a client payload (RFC-1).
export const RequestContextSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.string(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;
