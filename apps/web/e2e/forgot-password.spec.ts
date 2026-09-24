import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// No email provider: "Forgot password?" tells the tenant's admins, who reset
// the password from People. The answer never says whether the email exists.
// Needs the seeded anchor tenant and the API.

const CUSTOMER_EMAIL = process.env.SEED_CUSTOMER_EMAIL ?? 'customer@admin.com';

test('forgot password gives one answer for any email and alerts the admins', async ({ page }) => {
  for (const email of [`nobody-${Date.now()}@example.test`, CUSTOMER_EMAIL]) {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Request a reset' }).click();
    await expect(page.getByRole('status')).toContainText('If that email has an account');
  }
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await signIn(page);
  await page.goto('/app/notifications');
  await expect(page.getByText(`${CUSTOMER_EMAIL} asked to reset their password`).first()).toBeVisible({
    timeout: 15_000,
  });
});
