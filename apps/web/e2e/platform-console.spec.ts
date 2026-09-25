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
    await expect(sidebar.getByRole('link', { name: 'Companies' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Equipment and maintenance' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('Companies lists the seeded tenant with its stats and site link', async ({ page }) => {
    await page.goto(platformUrl('/admin/companies'));
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'Almara' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();
    // The site link follows the host family: almara.localhost in dev.
    await expect(row.getByRole('link', { name: /almara\.localhost/ })).toHaveAttribute('href', /^https?:\/\/almara\.localhost/);
    await expect(page.getByText('Equipment listed')).toBeVisible();
  });

  // Tenant shells do not exist on the platform host.
  for (const path of ['/app', '/app/inventory', '/field', '/account']) {
    test(`${path} on the platform host goes to the landing page`, async ({ page }) => {
      await page.goto(platformUrl(path));
      await expect(page).toHaveURL(platformUrl('/'));
    });
  }
});
