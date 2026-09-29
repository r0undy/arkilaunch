import { ConflictException } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { type Tx, couponRedemptions, coupons } from '@arkilaunch/db';
import { round2HalfUp } from '@arkilaunch/shared';

type Coupon = typeof coupons.$inferSelect;

// Never more than the rent, rounded the same way as the quote discount.
export function couponDiscount(coupon: Pick<Coupon, 'discountType' | 'discountValue'>, rentPhp: number): number {
  const value = Number(coupon.discountValue);
  const raw = coupon.discountType === 'percent' ? (rentPhp * value) / 100 : value;
  return round2HalfUp(Math.max(0, Math.min(rentPhp, raw)));
}

// The one definition both preview and claim use, so they can't disagree on "usable".
const usable = (code: string) =>
  and(
    eq(coupons.code, code),
    eq(coupons.active, true),
    or(isNull(coupons.expiresAt), gt(coupons.expiresAt, sql`now()`)),
    or(isNull(coupons.maxUses), lt(coupons.redeemedCount, coupons.maxUses)),
  );

// Every miss is the same answer, so a guesser can't tell whether a code exists, expired or ran out.
const invalid = () => new ConflictException({ error: 'coupon_invalid' });

async function assertNotUsedByCustomer(tx: Tx, coupon: Coupon, customerId: string) {
  if (!coupon.oncePerCustomer) return;
  const [used] = await tx
    .select({ id: couponRedemptions.id })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.customerId, customerId)))
    .limit(1);
  if (used) throw new ConflictException({ error: 'coupon_used' });
}

export async function previewCoupon(tx: Tx, code: string, customerId: string, rentPhp: number) {
  const [coupon] = await tx.select().from(coupons).where(usable(code)).limit(1);
  if (!coupon) throw invalid();
  await assertNotUsedByCustomer(tx, coupon, customerId);
  const discountPhp = couponDiscount(coupon, rentPhp);
  if (discountPhp <= 0) throw invalid();
  return { coupon, discountPhp };
}

// The guarded UPDATE is atomic and row-locks the coupon, so racing checkouts for the last use serialize here.
export async function claimCoupon(tx: Tx, code: string, customerId: string, rentPhp: number) {
  const [coupon] = await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
    .where(usable(code))
    .returning();
  if (!coupon) throw invalid();
  await assertNotUsedByCustomer(tx, coupon, customerId);
  const discountPhp = couponDiscount(coupon, rentPhp);
  if (discountPhp <= 0) throw invalid();
  return { coupon, discountPhp };
}
