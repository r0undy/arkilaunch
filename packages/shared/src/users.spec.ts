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

  // This case used to be folded into the assertion above, which asserted
  // that `owner` could never act on anyone. That stopped being true when
  // `owner` was granted governance of its own tenant's users (users.ts
  // ROLE_PROTECTED_FROM, "owner gained governance of its OWN tenant"), but
  // the assertion was never updated -- packages/shared's suite ran in no CI
  // job until cr-arkilaunch-pilot-honesty.md, so it failed unnoticed.
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

  // Pinned deliberately so the behaviour cannot drift silently either way.
  // NOTE: this documents current behaviour, which is NOT obviously the
  // intended one. ROLE_PROTECTED_FROM.owner lists only 'platform_admin', so
  // one owner may deactivate or role-change a co-owner. That is the same
  // lateral-takeover shape the table's own comment says it exists to
  // prevent ("an admin who can deactivate the tenant's own owner ... has
  // taken the tenant over"). It is currently low-reach because no role can
  // GRANT 'owner' through this API, so a second owner can only arrive via
  // platform seeding. Raised as a finding in cr-arkilaunch-pilot-honesty.md;
  // if the decision is to tighten it, add 'owner' to ROLE_PROTECTED_FROM
  // .owner and flip this assertion.
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
