import { test, expect } from '@playwright/test';
import { signInAsCustomer as signIn } from './sign-in.js';

// Needs the seeded anchor tenant (`pnpm db:seed`) and the API running.

test.describe('company applications', () => {
  test('lists the companies, counts them, and filters by status', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/applications');

    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible();

    // The seeded customer owns at least one company, so Total is non-zero and
    // the cards are on the page.
    const total = page.getByText('Total applications').locator('xpath=preceding-sibling::dd[1]');
    await expect(total).not.toHaveText('0');
    const cards = page.getByRole('group');
    await expect(cards.first()).toBeVisible();
    const all = await cards.count();

    await page.getByRole('button', { name: 'Pending approval' }).click();
    const pending = await page.getByRole('group').count();
    await page.getByRole('button', { name: 'Approved' }).click();
    const approved = await page.getByRole('group').count();
    expect(pending + approved).toBeLessThanOrEqual(all);

    await page.getByRole('button', { name: 'All applications' }).click();
    await expect(page.getByRole('group')).toHaveCount(all);
  });

  test('search narrows to one company, and says so when nothing matches', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/applications');

    const first = page.getByRole('group').first();
    await expect(first).toBeVisible();
    const name = await first.getAttribute('aria-label');
    expect(name).toBeTruthy();

    await page.getByRole('searchbox', { name: /search companies/i }).fill(name!);
    await expect(page.getByRole('group', { name: name! })).toBeVisible();

    await page
      .getByRole('searchbox', { name: /search companies/i })
      .fill('no-such-company-zzzzzzzz');
    await expect(page.getByRole('group')).toHaveCount(0);
    await expect(page.getByText(/No companies match/i)).toBeVisible();
  });

  test('Manage opens that company, and Add company opens the form', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/applications');

    const card = page.getByRole('group').first();
    const name = await card.getAttribute('aria-label');
    await card.getByRole('link', { name: 'Manage' }).click();

    await expect(page).toHaveURL(/\/account\/companies\/[0-9a-f-]+$/);
    // level 1 specifically: the detail page names the company twice, once in
    // the PageHeader and once on the card below it.
    await expect(page.getByRole('heading', { level: 1, name: name! })).toBeVisible();

    await page.getByRole('link', { name: 'Back to applications' }).click();
    await expect(page).toHaveURL(/\/account\/applications$/);

    await page.getByRole('link', { name: 'Add company' }).click();
    await expect(page).toHaveURL(/\/account\/companies\/new$/);
  });

  test('the old companies list redirects here', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/companies');
    await expect(page).toHaveURL(/\/account\/applications$/);
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible();
  });
});
