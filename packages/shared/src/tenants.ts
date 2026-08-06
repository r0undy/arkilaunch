import { z } from 'zod';
import { SEC_REGEX, TIN_REGEX } from './kyc.js';

// POST /tenants/register (@Public, backend-unblock plan workstream 1).
// Mirrors apps/web/src/lib/registration-client.ts's PersonalDetails +
// CompanyDetails two-step form. No `password` field: the owner sets their
// own password later through the proven POST /auth/activate flow once an
// admin approves the application (there is no platform-console approval UI
// yet, see the Change Record) -- storing a self-chosen password for an
// unapproved account would be new, unaudited state.
export const TenantRegisterRequestSchema = z.object({
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  mobileNumber: z.string().min(1).max(50),
  email: z.string().email(),
  jobTitle: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  businessAddress: z.string().min(1).max(500),
  secNumber: z.string().regex(SEC_REGEX),
  tin: z.string().regex(TIN_REGEX),
});
export type TenantRegisterRequest = z.infer<typeof TenantRegisterRequestSchema>;

export const TenantRegisterResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.literal('pending'),
});
export type TenantRegisterResponse = z.infer<typeof TenantRegisterResponseSchema>;

// POST /tenants/:id/approve | /reject (tenant:approve, platform_admin only).
// No platform-console UI exists yet (S3/S25 deferred) -- this is an
// API/curl-level step for now, logged honestly in the Change Record.
export const TenantApplicationDecisionResponseSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  // Present only on approve: relayed out-of-band by the platform admin to
  // the new owner, exactly like a user invite (no email provider in the
  // pinned stack).
  activationToken: z.string().optional(),
});
export type TenantApplicationDecisionResponse = z.infer<typeof TenantApplicationDecisionResponseSchema>;
