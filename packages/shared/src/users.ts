import { z } from 'zod';
import { ROLE_CODES, type RoleCode } from './permissions.js';
import { PaginationQuerySchema } from './pagination.js';
import { PhMobileSchema } from './phone.js';

// Never `owner` or `platform_admin`: neither is assignable through this API.
export const AssignableRoleSchema = z.enum(['admin', 'timekeeper', 'customer']);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'invited', 'disabled', 'locked']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserPasswordSchema = z.string().min(12).max(128);

export const UserListQuerySchema = PaginationQuerySchema.extend({
  status: UserStatusSchema.optional(),
  role: z.enum(ROLE_CODES).optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserInviteRequestSchema = z.object({
  // toLowerCase is load-bearing: AuthService.login lowercases the email it
  // looks up, so a mixed-case invite would create a user who can never log in.
  email: z.string().email().max(254).toLowerCase(),
  role: AssignableRoleSchema,
  projectSiteIds: z.array(z.string().uuid()).max(50).optional(),
});
export type UserInviteRequest = z.infer<typeof UserInviteRequestSchema>;

export const UserRoleChangeRequestSchema = z.object({ role: AssignableRoleSchema });
export type UserRoleChangeRequest = z.infer<typeof UserRoleChangeRequestSchema>;

export const SiteAssignmentSetRequestSchema = z.object({
  projectSiteIds: z.array(z.string().uuid()).max(50),
});
export type SiteAssignmentSetRequest = z.infer<typeof SiteAssignmentSetRequestSchema>;

export const UserActivateRequestSchema = z.object({
  activationToken: z.string().min(1),
  password: UserPasswordSchema,
});
export type UserActivateRequest = z.infer<typeof UserActivateRequestSchema>;

export const NotificationPrefsSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
  inApp: z.boolean(),
});

export const UserSelfResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
  status: UserStatusSchema,
  createdAt: z.coerce.date(),
  tenantName: z.string(),
  // Never public.
  tenantTin: z.string().nullable().optional(),
  tenantSlug: z.string(),
  // Names are KYC-owned and read-only here.
  firstName: z.string().nullable().optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  notificationPrefs: NotificationPrefsSchema.optional(),
});
export type UserSelfResponse = z.infer<typeof UserSelfResponseSchema>;

// Only what the user owns: never email, role or names.
export const UserSelfUpdateSchema = z
  .object({
    phone: PhMobileSchema.nullable(),
    address: z.string().trim().max(500).nullable(),
    notificationPrefs: NotificationPrefsSchema,
  })
  .partial()
  .strict();
export type UserSelfUpdate = z.infer<typeof UserSelfUpdateSchema>;

export const UserPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: UserPasswordSchema,
  })
  .strict();
export type UserPasswordChange = z.infer<typeof UserPasswordChangeSchema>;

// platform_admin is absent from every value, so no key can ever grant it; owner cannot grant owner either.
export const ROLE_ASSIGNABLE_BY: Record<RoleCode, readonly AssignableRole[]> = {
  platform_admin: ['admin', 'timekeeper', 'customer'],
  admin: ['admin', 'timekeeper', 'customer'],
  owner: ['admin', 'timekeeper', 'customer'],
  timekeeper: [],
  customer: [],
};

// Lateral-takeover defense: roles an actor may never act on, whatever role is requested.
export const ROLE_PROTECTED_FROM: Record<RoleCode, readonly RoleCode[]> = {
  platform_admin: ['platform_admin'],
  admin: ['platform_admin', 'owner'],
  owner: ['platform_admin'],
  timekeeper: [...ROLE_CODES],
  customer: [...ROLE_CODES],
};

export type UserAdminDenial =
  | 'self_mutation_forbidden'
  | 'role_not_assignable'
  | 'target_role_protected'
  | 'last_user_manager';

export type UserAdminVerdict = { allowed: true } | { allowed: false; reason: UserAdminDenial };

export function evaluateUserAdminAction(input: {
  actorRole: RoleCode;
  actorUserId: string;
  targetUserId: string;
  targetRole: RoleCode;
  requestedRole?: AssignableRole;
  wouldLeaveZeroUserManagers?: boolean;
}): UserAdminVerdict {
  if (input.actorUserId === input.targetUserId) {
    return { allowed: false, reason: 'self_mutation_forbidden' };
  }
  if (input.requestedRole && !ROLE_ASSIGNABLE_BY[input.actorRole].includes(input.requestedRole)) {
    return { allowed: false, reason: 'role_not_assignable' };
  }
  if (ROLE_PROTECTED_FROM[input.actorRole].includes(input.targetRole)) {
    return { allowed: false, reason: 'target_role_protected' };
  }
  if (input.wouldLeaveZeroUserManagers) {
    return { allowed: false, reason: 'last_user_manager' };
  }
  return { allowed: true };
}
