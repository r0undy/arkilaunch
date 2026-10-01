import { test, expect } from '@playwright/test';

test('unauthenticated visitor sees the public storefront at /', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rent now' })).toBeVisible();
});

test('unauthenticated visitor is redirected to login from /app', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
