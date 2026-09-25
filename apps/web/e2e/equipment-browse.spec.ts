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

// The rail appears at xl (1280); the sidebar collapses into a drawer below lg
// (1024). Two different thresholds, so the specs name them separately rather
// than sharing one "is this a phone" flag.
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const hasRail = (page: Page) => (page.viewportSize()?.width ?? 1440) >= 1280;

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
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('a visitor gets the storefront, not a login wall', async ({ page }) => {
    await page.goto('/equipment');

    await expect(page).toHaveURL(/\/equipment$/);
    await expect(page.getByRole('heading', { name: /equipment for hire/i })).toBeVisible();
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

  test('weather sits beside the catalog when there is room, and under it when there is not', async ({
    page,
  }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');

    // Present either way -- the point of stacking rather than hiding is that
    // a narrow screen still gets the forecast.
    const panel = page.getByRole('complementary', { name: 'Weather insights' });
    await expect(panel).toBeVisible();

    const heading = page.getByRole('heading', { name: /equipment for hire/i });
    // Visible above, so both boxes exist.
    const panelBox = (await panel.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;
    if (hasRail(page)) {
      // Top right: to the right of the heading and level with it, not below.
      expect(panelBox.x).toBeGreaterThan(headingBox.x);
      expect(panelBox.y).toBeLessThan(headingBox.y + 120);
    } else {
      expect(panelBox.y).toBeGreaterThan(headingBox.y);
    }
  });

  test('the skip link is the first tab stop and becomes visible when focused', async ({ page }) => {
    await page.goto('/equipment');
    // Wait for the catalog to finish loading BEFORE tabbing. The query
    // resolving mid-test re-renders the tree and drops focus, so a Tab
    // pressed while the skeleton is still up lands nowhere -- which is how
    // this failed once the grid change made the first paint land sooner.
    await expect(page.getByRole('button', { name: /^rent$/i }).first()).toBeVisible();

    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    // And it actually goes somewhere: every shell puts id="main" on its own
    // <main>, so the link has a target on this page.
    await expect(page.locator('main#main')).toHaveCount(1);
  });

  test('every catalog card shows a price or "Price on request"', async ({ page }) => {
    await page.goto('/equipment');
    const prices = page.getByTestId('equipment-card-price');
    await expect(prices.first()).toBeVisible();
    for (const text of await prices.allTextContents()) {
      expect(text).toMatch(/\d \/ (hour|day)$|^Price on request$/);
    }
  });
});
