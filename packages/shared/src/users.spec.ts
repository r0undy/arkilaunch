import { describe, expect, it } from 'vitest';
import { ROLE_CODES, type RoleCode } from './permissions.js';
import { AssignableRoleSchema, evaluateUserAdminAction, type AssignableRole } from './users.js';

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

  // The exhaustive matrix: every (actorRole x targetRole x requestedRole)
  // triple. This is what catches a future ROLE_CODES addition silently
  // becoming grantable by editing the wrong array -- platform_admin and
  // owner must NEVER appear in an allowed outcome as a requestedRole, no
  // matter which actor role is tried.
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

  it('owner, timekeeper, and customer can never act on anyone (protected-from-everything)', () => {
    for (const actorRole of ['owner', 'timekeeper', 'customer'] as RoleCode[]) {
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
