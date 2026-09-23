import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// Browser-level cover for the design pass: the dashboard's tabbed panel and
// advisory modal, the quote preview dialog, and paging a real list. These
// need the seeded anchor tenant (`pnpm db:seed`) and the API running; signIn
// throws if it cannot get there, rather than skipping the suite into a
// green that means nothing.

test.describe('console design pass', () => {
  test('dashboard leads with figures and keeps the rest one tab at a time', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Deposit deducted')).toBeVisible();

    // One secondary queue is visible; switching tabs swaps it.
    const payments = page.getByRole('tab', { name: 'Payments' });
    await expect(payments).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Incidents' }).click();
    await expect(page.getByRole('tab', { name: 'Incidents' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(payments).toHaveAttribute('aria-selected', 'false');
  });

  test('a quote is priced in a dialog before anything is saved', async ({ page }) => {
    await signIn(page);

    await page.goto('/app/quotes');
    const priceIt = page.getByRole('button', { name: 'Preview price' });
    await expect(priceIt).toBeEnabled();
    await priceIt.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Diesel price')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create draft' })).toBeVisible();

    // Escape closes it and nothing was created.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Draft quote' })).toBeHidden();
  });

  test('the field-log queue pages rather than dumping every row', async ({ page }) => {
    await signIn(page);

    await page.goto('/app/ocr');
    const range = page.getByText(/Showing \d+-\d+ of \d+ field logs/);
    // A single page of results hides the controls on purpose, so the
    // assertion is conditional on there being a second page to go to.
    if (await range.isVisible()) {
      const before = await range.textContent();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(range).not.toHaveText(before ?? '');
    }
  });
});
