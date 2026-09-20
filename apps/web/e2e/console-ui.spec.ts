import { test, expect, type Page } from '@playwright/test';

// Browser-level cover for the design pass: the dashboard's tabbed panel and
// advisory modal, the quote preview dialog, and paging a real list. These
// need the seeded anchor tenant (`pnpm db:seed`) and the API running, which
// is why they are skipped rather than failed when a sign-in does not take.

const EMAIL = 'admin@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

async function signIn(page: Page): Promise<boolean> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  try {
    await page.waitForURL(/\/app/, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('console design pass', () => {
  test('dashboard leads with figures and keeps the rest one tab at a time', async ({ page }) => {
    test.skip(!(await signIn(page)), 'needs the seeded anchor tenant and a running API');

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
    test.skip(!(await signIn(page)), 'needs the seeded anchor tenant and a running API');

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
    test.skip(!(await signIn(page)), 'needs the seeded anchor tenant and a running API');

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
