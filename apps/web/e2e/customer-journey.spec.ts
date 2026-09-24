import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';

// Needs the seeded anchor tenant and the API running.

test.describe('customer journey', () => {
  test('the bell sits right of the cart and its panel leads to the full page', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');

    const cart = page.getByRole('link', { name: /^Cart/ });
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    const [cartBox, bellBox] = [await cart.boundingBox(), await bell.boundingBox()];
    expect(bellBox!.x).toBeGreaterThan(cartBox!.x);

    await bell.click();
    const panel = page.getByRole('region', { name: 'Latest notifications' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Loading/)).toBeHidden();
    expect(await panel.getByRole('listitem').count()).toBeLessThanOrEqual(5);

    await panel.getByRole('link', { name: 'See more' }).click();
    await expect(page).toHaveURL(/\/account\/notifications/);
    await expect(panel).toBeHidden();
  });

  test('the catalog labels no equipment status', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');
    await expect(page.getByRole('button', { name: /rent/i }).first()).toBeVisible();
    await expect(page.getByText(/^(Deployed|In maintenance)$/)).toHaveCount(0);
    // Everything listed on browse is rentable.
    await expect(page.locator('main button[disabled]', { hasText: /^Rent$/ })).toHaveCount(0);
  });

  test('the storefront labels no status and greys out what cannot be rented', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /rent/i }).first()).toBeVisible();
    await expect(page.getByText(/^(Deployed|In maintenance|Available)$/)).toHaveCount(0);
  });

  test('no horizontal scroll on the catalog', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/equipment');
    await expect(page.getByRole('button', { name: /rent/i }).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
