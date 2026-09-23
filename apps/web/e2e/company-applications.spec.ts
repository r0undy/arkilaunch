import { test, expect, type Page } from '@playwright/test';

// The Figma company list (251:1945) at /account/applications, in a browser.
// Needs the seeded anchor tenant (`pnpm db:seed`) and the API running.
//
// A failed sign-in fails the test rather than skipping it. A skip here
// reports green while asserting nothing, which is how this suite previously
// hid a broken sign-in for several passes.

const EMAIL = 'customer@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/account/, { timeout: 15_000 });
}

test.describe('company applications', () => {
  test('lists the companies, counts them, and filters by status', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/applications');

    await expect(page.getByRole('heading', { name: 'Company Applications' })).toBeVisible();

    // The seeded customer owns at least one company, so Total is non-zero and
    // the cards are on the page.
    const total = page.getByText('Total Applications').locator('xpath=preceding-sibling::dd[1]');
    await expect(total).not.toHaveText('0');
    const cards = page.getByRole('group');
    await expect(cards.first()).toBeVisible();
    const all = await cards.count();

    // Each tab is a subset of All, and the two together account for every
    // card -- a company is pending or approved, never both and never neither
    // once rejected ones are excluded.
    await page.getByRole('button', { name: 'Pending Approval' }).click();
    const pending = await page.getByRole('group').count();
    await page.getByRole('button', { name: 'Approved' }).click();
    const approved = await page.getByRole('group').count();
    expect(pending + approved).toBeLessThanOrEqual(all);

    await page.getByRole('button', { name: 'All Applications' }).click();
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

  test('Manage opens that company, and Add New Company opens the form', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/applications');

    const card = page.getByRole('group').first();
    const name = await card.getAttribute('aria-label');
    await card.getByRole('link', { name: 'Manage' }).click();

    await expect(page).toHaveURL(/\/account\/companies\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: name! })).toBeVisible();

    await page.getByRole('link', { name: 'Back to applications' }).click();
    await expect(page).toHaveURL(/\/account\/applications$/);

    await page.getByRole('link', { name: 'Add New Company' }).click();
    await expect(page).toHaveURL(/\/account\/companies\/new$/);
  });

  // /account/companies was a second list of the same rows. It redirects
  // rather than 404s: it is linked from older material.
  test('the old companies list redirects here', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/companies');
    await expect(page).toHaveURL(/\/account\/applications$/);
    await expect(page.getByRole('heading', { name: 'Company Applications' })).toBeVisible();
  });
});
