import { test, expect } from '@playwright/test';

// Money-path E2E (OCR->reconciliation->deduction; quote->PayMongo->webhook)
// lands with F3/F1 (QAD §CI). This is the F7 slice's coverage: the
// unauthenticated redirect and the accessible login form render.
test('unauthenticated visitor is redirected to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to ArkiLaunch' })).toBeVisible();
});
