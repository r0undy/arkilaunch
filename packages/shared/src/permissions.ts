// Seed permission codes for the F7 slice (RFC-1 §3, RFC1-07). Additional
// feature slices append their own codes here; this list is not exhaustive
// for the whole product, only for what F7 enforces today.
export const PERMISSION_CODES = [
  'tenant:manage',
  'user:manage',
  'quote:create',
  'quote:read',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const ROLE_CODES = ['platform_admin', 'owner', 'admin', 'timekeeper'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
