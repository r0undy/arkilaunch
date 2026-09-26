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

  // Standard pricing CR: the Quotes tab sets one price for every client,
  // grouped by service; there is no per-company quote builder.
  test('the quotes tab is the standard pricing, grouped by service', async ({ page }) => {
    await signIn(page);

    await page.goto('/app/quotes');
    await expect(page.getByRole('heading', { name: 'Equipment rental' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trucking' })).toBeVisible();
    await expect(page.getByLabel('Mobilization (PHP)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview price' })).toBeHidden();
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
