import { expect, test } from '@playwright/test';
import { platformUrl, signInAsPlatformAdmin } from './sign-in.js';

// The platform admin's console: /admin on the platform host, its own short
// sidebar, and no way into a tenant's shells from there.
test.describe('platform console', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsPlatformAdmin(page);
  });

  test('lands on Applications with only the platform sidebar', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar.getByRole('link', { name: 'Approved companies' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Equipment and maintenance' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('Approved companies is a real list, not a placeholder', async ({ page }) => {
    await page.goto(platformUrl('/admin/approved'));
    await expect(page.getByRole('heading', { name: 'Approved companies', level: 1 })).toBeVisible();
    await expect(page.getByText(/are not listed yet/i)).toHaveCount(0);
    const loaded = page.getByRole('table').or(page.getByText('No approved companies yet'));
    await expect(loaded.first()).toBeVisible();
  });

  // Tenant shells do not exist on the platform host.
  for (const path of ['/app', '/app/inventory', '/field', '/account']) {
    test(`${path} on the platform host goes to the landing page`, async ({ page }) => {
      await page.goto(platformUrl(path));
      await expect(page).toHaveURL(platformUrl('/'));
    });
  }
});
