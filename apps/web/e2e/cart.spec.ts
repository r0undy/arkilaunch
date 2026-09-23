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

  test('an unverified company cannot be chosen', async ({ page }) => {
    await openCartWithAMachine(page);

    const select = page.locator('#cart-company');
    // Only present when there is a choice to make or a company that cannot be
    // chosen; a single verified company is picked without asking.
    if (await select.count()) {
      for (const option of await select.locator('option').all()) {
        const label = (await option.textContent()) ?? '';
        const disabled = await option.isDisabled();
        // The label carries the reason whenever the option is unusable.
        if (/awaiting verification|verification declined/.test(label)) {
          expect(disabled).toBe(true);
        }
      }
    }
  });

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
  });
});
