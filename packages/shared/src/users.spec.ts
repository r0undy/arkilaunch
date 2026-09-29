import { describe, expect, it } from 'vitest';
import { ROLE_CODES, type RoleCode } from './permissions.js';
import { AssignableRoleSchema, evaluateUserAdminAction, UserPasswordChangeSchema, type AssignableRole } from './users.js';

const ASSIGNABLE_ROLES = AssignableRoleSchema.options;
const ACTOR_ID = 'actor';
const TARGET_ID = 'target';

describe('evaluateUserAdminAction (S19 privilege-escalation policy, pure)', () => {
  it('denies self-mutation for every role change, regardless of actor/target role', () => {
    for (const actorRole of ROLE_CODES) {
      for (const requestedRole of ASSIGNABLE_ROLES) {
        const verdict = evaluateUserAdminAction({
          actorRole,
          actorUserId: ACTOR_ID,
          targetUserId: ACTOR_ID,
          targetRole: actorRole,
          requestedRole,
        });
        expect(verdict).toEqual({ allowed: false, reason: 'self_mutation_forbidden' });
      }
    }
  });

  // Exhaustive matrix: platform_admin and owner must NEVER be an allowed requestedRole.
  it('never allows granting platform_admin or owner, for any actor', () => {
    for (const actorRole of ROLE_CODES) {
      for (const targetRole of ROLE_CODES) {
        for (const requestedRole of ['platform_admin', 'owner'] as const) {
          const verdict = evaluateUserAdminAction({
            actorRole,
            actorUserId: ACTOR_ID,
            targetUserId: TARGET_ID,
            targetRole,
            requestedRole: requestedRole as AssignableRole,
          });
          expect(verdict.allowed).toBe(false);
        }
      }
    }
  });

  it('admin may grant admin/timekeeper/customer to a non-protected target', () => {
    for (const requestedRole of ASSIGNABLE_ROLES) {
      const verdict = evaluateUserAdminAction({
        actorRole: 'admin',
        actorUserId: ACTOR_ID,
        targetUserId: TARGET_ID,
        targetRole: 'timekeeper',
        requestedRole,
      });
      expect(verdict).toEqual({ allowed: true });
    }
  });

  it('admin cannot act on an owner or platform_admin target, even with no requestedRole (deactivate/reactivate)', () => {
    for (const targetRole of ['owner', 'platform_admin'] as RoleCode[]) {
      const verdict = evaluateUserAdminAction({
        actorRole: 'admin',
        actorUserId: ACTOR_ID,
        targetUserId: TARGET_ID,
        targetRole,
      });
      expect(verdict).toEqual({ allowed: false, reason: 'target_role_protected' });
    }
  });

  it('timekeeper and customer can never act on anyone (protected-from-everything)', () => {
    for (const actorRole of ['timekeeper', 'customer'] as RoleCode[]) {
      for (const targetRole of ROLE_CODES) {
        const verdict = evaluateUserAdminAction({
          actorRole,
          actorUserId: ACTOR_ID,
          targetUserId: TARGET_ID,
          targetRole,
        });
        expect(verdict.allowed).toBe(false);
      }
    }
  });

  it('owner governs its own tenant staff but is blocked from platform_admin', () => {
    for (const targetRole of ['admin', 'timekeeper', 'customer'] as RoleCode[]) {
      const verdict = evaluateUserAdminAction({
        actorRole: 'owner',
        actorUserId: ACTOR_ID,
        targetUserId: TARGET_ID,
        targetRole,
      });
      expect(verdict, `owner should be able to administer a ${targetRole}`).toEqual({
        allowed: true,
      });
    }

    const blocked = evaluateUserAdminAction({
      actorRole: 'owner',
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      targetRole: 'platform_admin',
    });
    expect(blocked).toEqual({ allowed: false, reason: 'target_role_protected' });
  });

  // Pins current behaviour, which is NOT obviously intended: an owner may act on a co-owner. Low reach (no API
  // grants owner); to tighten, add 'owner' to ROLE_PROTECTED_FROM.owner and flip this assertion.
  it('owner-on-owner: currently permitted (open finding, see comment)', () => {
    const verdict = evaluateUserAdminAction({
      actorRole: 'owner',
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      targetRole: 'owner',
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it('the last-user-manager guard denies only when it would leave zero managers', () => {
    const denied = evaluateUserAdminAction({
      actorRole: 'admin',
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      targetRole: 'admin',
      wouldLeaveZeroUserManagers: true,
    });
    expect(denied).toEqual({ allowed: false, reason: 'last_user_manager' });

    const allowed = evaluateUserAdminAction({
      actorRole: 'admin',
      actorUserId: ACTOR_ID,
      targetUserId: TARGET_ID,
      targetRole: 'admin',
      wouldLeaveZeroUserManagers: false,
    });
    expect(allowed).toEqual({ allowed: true });
  });
});

describe('UserPasswordChangeSchema', () => {
  it('requires a 12-character new password', () => {
    expect(UserPasswordChangeSchema.safeParse({ currentPassword: 'x', newPassword: 'a'.repeat(11) }).success).toBe(false);
    expect(UserPasswordChangeSchema.safeParse({ currentPassword: 'x', newPassword: 'a'.repeat(12) }).success).toBe(true);
  });
});
