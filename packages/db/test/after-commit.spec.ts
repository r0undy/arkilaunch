import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { afterCommit, withTenantTx } from '../src/index.js';
import { directSql, getTenantId } from './helpers.js';

// Emails for money events are queued with afterCommit: they must go out
// only when the transaction commits, never on a rollback, and a failing
// send must not fail the (already committed) request.
describe('afterCommit', () => {
  const direct = directSql();
  let tenantId: string;
  beforeAll(async () => {
    tenantId = await getTenantId(direct, 'test-tenant-a');
  });
  afterAll(() => direct.end());
  const ctx = () => ({ tenantId, userId: tenantId, role: 'admin' });

  it('runs after commit, not on rollback, and swallows a failing callback', async () => {
    const ran: string[] = [];
    const result = await withTenantTx(ctx(), async (tx) => {
      afterCommit(tx, async () => {
        throw new Error('resend down');
      });
      afterCommit(tx, async () => {
        ran.push('committed');
      });
      expect(ran).toEqual([]);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(ran).toEqual(['committed']);

    await expect(
      withTenantTx(ctx(), async (tx) => {
        afterCommit(tx, async () => {
          ran.push('rolled back');
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    expect(ran).toEqual(['committed']);
  });
});
