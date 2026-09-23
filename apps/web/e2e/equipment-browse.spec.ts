import { test, expect, type Page } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';
import { openSidebar, sidebarLink } from './sidebar.js';

// Browsing equipment, in a browser, at both viewports.
//
// THE BUG: /equipment sat under the marketing layout while the account
// sidebar pointed at it, so one click cost a signed-in customer their
// sidebar, app bar, notification bell and cart. Needs the seeded anchor
// tenant (`pnpm db:seed`) and the API running; sign-in fails rather
// than skips.

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

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
    if (isMobile(page)) {
      await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
    }
    await openSidebar(page);
    await expect(sidebarLink(page, 'Cart')).toBeVisible();
    // Not the marketing chrome.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('a visitor gets the storefront, not a login wall', async ({ page }) => {
    await page.goto('/equipment');

    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole('heading', { name: /equipment for hire/i })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toHaveCount(0);
  });

  test('the cart count follows an add, with no reload', async ({ page }) => {
    await signInAsCustomer(page);
    await addFirstMachine(page);

    await openSidebar(page);
    // The badge is part of the entry's accessible name. Filtered to the
    // visible copy: with the drawer open the hidden desktop aside still holds
    // one too.
    await expect(page.getByLabel(/in cart/).filter({ visible: true })).toBeVisible();
  });

  test('the right rail lists the cart on a wide screen and stays out of the way on a phone', async ({
    page,
  }) => {
    await signInAsCustomer(page);
    await addFirstMachine(page);

    const rail = page.getByRole('complementary', { name: 'Cart and weather' });
    if (isMobile(page)) {
      await expect(rail).toBeHidden();
    } else {
      await expect(rail).toBeVisible();
      await expect(rail).toContainText('Cart (1)');
      await rail.getByRole('button', { name: 'View details' }).click();
      await expect(page).toHaveURL(/\/account\/cart$/);
    }
  });

  test('the skip link is the first tab stop and becomes visible when focused', async ({ page }) => {
    await page.goto('/equipment');
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });
});
