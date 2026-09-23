import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';

// The cart's validation and the sidebar blade, in a browser. Needs the seeded
// anchor tenant (`pnpm db:seed`) and the API running; sign-in fails rather
// than skips.

async function openCartWithAMachine(page: import('@playwright/test').Page) {
  await signInAsCustomer(page);
  await page.goto('/equipment');
  // The catalog card's rent action opens a date dialog on the list page.
  await page.getByRole('button', { name: /rent/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /cart/i }).first().click();
  await page.goto('/account/cart');
  await expect(page.getByRole('heading', { name: 'Shopping cart' })).toBeVisible();
}

test.describe('cart', () => {
  test('refuses to submit with a reason on the field, not a dead button', async ({ page }) => {
    await openCartWithAMachine(page);

    const submit = page.getByRole('button', { name: 'Request a quote' });
    // The old behaviour: disabled, and the customer is left to guess why.
    await expect(submit).toBeEnabled();
    await submit.click();

    // Site is always required and is never auto-filled, so it is the one
    // error that is guaranteed present on a fresh cart.
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/account\/cart/);
  });

  // The disabled-option logic is covered exhaustively in
  // cart-validation.test.ts against every kyc state. There is no browser
  // assertion worth making here: the seeded account has exactly one verified
  // company, so the select is not rendered at all, and a spec that walks an
  // absent element asserts nothing.

  test('the line shows what was added, not just a model name', async ({ page }) => {
    await openCartWithAMachine(page);
    const line = page.getByRole('group').first();
    await expect(line).toBeVisible();
    await expect(line.getByText(/rental day/i)).toBeVisible();
  });

  // The blade said "you are here" on a page the customer was not on: /account
  // is a prefix of every account URL, so Home lit up on the cart too.
  test('the sidebar does not mark Home active on the cart', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/account');
    await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await page.goto('/account/cart');
    await expect(page.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    // Exactly one destination is ever marked, and on the cart it is Cart.
    await expect(page.getByRole('link', { name: 'Cart' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
