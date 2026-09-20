import { test, expect } from '@playwright/test';

// Money-path E2E (OCR->reconciliation->deduction; quote->PayMongo->webhook)
// lands with F3/F1 (QAD §CI). This covers the F7 slice's auth boundary:
// / is now the public storefront (not an authed redirect, per the PRD IA),
// and /app requires auth.
test('unauthenticated visitor sees the public storefront at /', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Industrial fleet management/i })).toBeVisible();
});

test('unauthenticated visitor is redirected to login from /app', async ({ page }) => {
  await page.goto('/app');
  // The guard preserves where you were headed, so the URL carries
  // ?redirect=%2Fapp -- anchoring on $ here predates that.
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
