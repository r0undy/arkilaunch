import { z } from 'zod';
import { ROLE_CODES, type RoleCode } from './permissions.js';

// S19 Users & Roles (PRD-F7). A role assignable through this API -- never
// `owner` (tenant-governance act, belongs to the platform console, S25) or
// `platform_admin` (RFC-1's reserved cross-tenant role, minted only via
// service_role seeding).
export const AssignableRoleSchema = z.enum(['admin', 'timekeeper', 'customer']);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'invited', 'disabled', 'locked']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

// min 12: this is the only place a password is CHOSEN. LoginRequestSchema's
// min(1) validates a submitted credential, not a chosen one.
export const UserPasswordSchema = z.string().min(12).max(128);

export const UserListQuerySchema = z.object({
  status: UserStatusSchema.optional(),
  role: z.enum(ROLE_CODES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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

export const TenantSettingsUpdateRequestSchema = z
  .object({
    legalName: z.string().min(1).max(200),
  })
  .strict(); // .strict(): a status/kycState/slug field is a 400, not silently dropped

export type TenantSettingsUpdateRequest = z.infer<typeof TenantSettingsUpdateRequestSchema>;

// GET /users/me. Self-service profile read -- distinct route from the
// user:manage-gated UsersController (that controller is class-level gated;
// a caller reading their OWN record is not a privileged action). No PATCH
// counterpart yet: users has no self-editable field today (email/role/status
// are all admin-governed; a display-name column does not exist), so a PATCH
// route here would either accept nothing or smuggle back a governed field --
// deferred until there is a real editable field (restraint ladder).
export const UserSelfResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
  status: UserStatusSchema,
  createdAt: z.coerce.date(),
});
export type UserSelfResponse = z.infer<typeof UserSelfResponseSchema>;

// A role any actor may grant through this API. `platform_admin` is absent
// from every value here -- there is no key that can ever produce it, not
// merely an empty array, so a future ROLE_CODES addition cannot silently
// become grantable by editing the wrong array. `owner` gained governance of
// its OWN tenant (Phase 2, S3 self-service signup: a provisioned tenant's
// first user is `owner`, and it must be able to invite/administer its own
// users) but still cannot grant `owner` or `platform_admin` to anyone --
// minting a co-owner or reaching platform authority stays out of this API.
export const ROLE_ASSIGNABLE_BY: Record<RoleCode, readonly AssignableRole[]> = {
  platform_admin: ['admin', 'timekeeper', 'customer'],
  admin: ['admin', 'timekeeper', 'customer'],
  owner: ['admin', 'timekeeper', 'customer'],
  timekeeper: [],
  customer: [],
};

// Roles an actor may never ACT ON (deactivate/reactivate/role-change/
// assignment-write), regardless of what role is being requested. This is
// the defense against lateral takeover: an admin who can deactivate the
// tenant's own owner, or demote a platform_admin, has taken the tenant over
// without ever granting themselves anything. `owner` now governs its own
// tenant's users, so it is protected only from acting on `platform_admin`
// (RFC-1's reserved cross-tenant role) -- never from acting on its own
// admin/timekeeper/customer staff, which is the whole point of the grant.
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

// Pure policy, no DB/IO -- unit-testable in isolation from
// UsersService's withTenantTx orchestration, mirroring evaluateGate() in
// edtr.ts. `requestedRole` is only present on a role-change/invite action.
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
