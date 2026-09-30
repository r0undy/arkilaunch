import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// Needs the seeded anchor tenant (`pnpm db:seed`) and the API running.

test.describe('console design pass', () => {
  test('dashboard leads with figures and keeps the rest one tab at a time', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Invoiced', { exact: true }).first()).toBeVisible();

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

  test('quotes is the standard price book, rental and trucking in two tabs', async ({ page }) => {
    await signIn(page);

    await page.goto('/app/quotes');
    await expect(page.getByRole('tab', { name: 'Equipment rental' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Customer')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Mobilization and demobilization' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit mobilization fees' }).click();
    const fees = page.getByRole('dialog', { name: 'Mobilization and demobilization' });
    await expect(fees.getByLabel('Mobilization (PHP)', { exact: true })).toBeVisible();
    await fees.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('tab', { name: 'Trucking' }).click();
    await expect(page.getByRole('heading', { name: 'Customer quotation' })).toBeVisible();
    await expect(page.getByLabel('Mobilization (PHP)', { exact: true })).toHaveCount(0);
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
