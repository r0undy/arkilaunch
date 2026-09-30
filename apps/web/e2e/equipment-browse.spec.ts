import { test, expect, type Page } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';
import { openSidebar, sidebarLink } from './sidebar.js';

// Needs the seeded anchor tenant (`pnpm db:seed`) and the API running.

// The sidebar collapses into a drawer below lg (1024).
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function addFirstMachine(page: Page) {
  await page.goto('/equipment');
  await page.getByRole('button', { name: /^rent$/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to cart' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('equipment browsing', () => {
  test('a signed-in customer keeps their shell', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');

    // Below lg the sidebar collapses into the drawer, so on a phone the app
    // bar's menu button stands in for it.
    if (isNarrow(page)) {
      await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
    }
    await openSidebar(page);
    await expect(sidebarLink(page, 'My bookings')).toBeVisible();
    // Not the marketing chrome.
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCount(0);
  });

  test('a visitor gets the storefront, not a login wall', async ({ page }) => {
    await page.goto('/equipment');

    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole('heading', { name: 'Equipment for hire', level: 1 })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toHaveCount(0);
  });

  test('the app bar cart counts what was added, with no reload', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');
    // Empty before, counted after -- the bar subscribes to the same store the
    // cart page writes to, so nothing reloads in between.
    await expect(page.getByRole('link', { name: 'Cart, empty' })).toBeVisible();

    await addFirstMachine(page);
    await expect(page.getByRole('link', { name: /^Cart, \d+ items$/ })).toBeVisible();
  });

  test('weather opens from the button beside the search, on any screen width', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');

    // A button rather than a side panel, so a narrow screen still gets the forecast.
    await page.getByRole('button', { name: /Weather insights/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Weather insights' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('the skip link is the first tab stop and becomes visible when focused', async ({ page }) => {
    await page.goto('/equipment');
    // Wait for the catalog BEFORE tabbing: a mid-test re-render drops focus.
    await expect(page.getByRole('button', { name: /^rent$/i }).first()).toBeVisible();

    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await expect(page.locator('main#main')).toHaveCount(1);
  });
});
