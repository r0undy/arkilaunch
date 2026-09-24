import { expect, test } from '@playwright/test';
import { signInAsPlatformAdmin } from './sign-in.js';

// The platform admin's console: its own short sidebar, no tenant operations
// pages, and no way into the timekeeper or customer shells.
test.describe('platform console', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsPlatformAdmin(page);
  });

  test('lands on Applications with only the platform sidebar', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar.getByRole('link', { name: 'Approved companies' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Equipment' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('Approved companies is a real list, not a placeholder', async ({ page }) => {
    await page.goto('/app/companies/approved');
    await expect(page.getByRole('heading', { name: 'Approved companies', level: 1 })).toBeVisible();
    await expect(page.getByText(/are not listed yet/i)).toHaveCount(0);
    // The list loaded: either rows or its own empty state, never the error
    // panel a missing endpoint or function renders.
    const loaded = page
      .getByRole('table')
      .or(page.getByText('No approved companies yet'));
    await expect(loaded.first()).toBeVisible();
  });

  for (const path of ['/app', '/app/inventory', '/field', '/account']) {
    test(`${path} sends it back to Applications`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/companies\/pending$/);
    });
  }
});
