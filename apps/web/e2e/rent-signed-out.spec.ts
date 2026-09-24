import { test, expect } from '@playwright/test';

// Its own file because every other cart spec signs in first, and the whole
// point here is the visitor path.
//
// /account/cart is behind requireAuth(), so "Book now" used to hand a
// signed-out visitor a silent guard bounce with no destination -- from the
// customer's side, indistinguishable from the button not working.

const EMAIL = process.env.SEED_CUSTOMER_EMAIL ?? 'customer@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

test.describe('renting while signed out', () => {
  test('sends the visitor to login and keeps the machine waiting for them', async ({ page }) => {
    await page.goto('/equipment');

    await page.getByRole('button', { name: /^rent$/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The label says what will actually happen.
    const book = dialog.getByRole('button', { name: 'Sign in to book' });
    await expect(book).toBeVisible();
    await book.click();

    await expect(page).toHaveURL(/\/login\?.*redirect=%2Faccount%2Fcart/);

    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Signed in, on the cart, with the machine still in it: the cart lives in
    // sessionStorage and survives the redirect within the same tab.
    await expect(page).toHaveURL(/\/account\/cart$/, { timeout: 15_000 });
    await expect(page.getByRole('group').first()).toBeVisible();
  });
});
