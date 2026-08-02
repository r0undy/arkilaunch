// Seed permission codes for the F7 slice (RFC-1 §3, RFC1-07). Additional
// feature slices append their own codes here; this list is not exhaustive
// for the whole product, only for what F7 enforces today.
export const PERMISSION_CODES = [
  'tenant:manage',
  'user:manage',
  'quote:create',
  'quote:read',
  'quote:approve',
  'edtr:create',
  'edtr:approve',
  'kyc:extract',
  'kyc:verify',
  'diesel:manage',
  'pricing:manage',
  'fleet:manage',
  'report:read',
  // PRD-F8/F2 (cr-arkilaunch-f2-f8-bookings-payments.md).
  'booking:create',
  'booking:read',
  'payment:checkout',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

// `customer` added for PRD-F8 (cr-arkilaunch-f2-f8-bookings-payments.md):
// an authenticated end-customer role, not the public/guest catalog the PRD
// sketch implies -- RFC-1's "tenant_id only from a verified JWT" rules out
// a client-supplied tenant on an unauthenticated booking write.
export const ROLE_CODES = ['platform_admin', 'owner', 'admin', 'timekeeper', 'customer'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
