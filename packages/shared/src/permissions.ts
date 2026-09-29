export const PERMISSION_CODES = [
  'tenant:manage',
  'user:manage',
  'quote:create',
  'quote:read',
  'quote:approve',
  // edtr:read (queue, detail, scan) is staff only.
  'edtr:create',
  'edtr:read',
  'edtr:approve',
  'kyc:extract',
  'kyc:verify',
  'diesel:manage',
  'pricing:manage',
  'fleet:manage',
  'report:read',
  'booking:create',
  'booking:read',
  'payment:checkout',
  'billing:read',
  'site:manage',
  // platform_admin only.
  'tenant:approve',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const ROLE_CODES = ['platform_admin', 'owner', 'admin', 'timekeeper', 'customer'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
