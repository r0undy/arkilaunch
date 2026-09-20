import { test, expect } from '@playwright/test';

// The public tier needs no sign-in, so these run wherever the API and its
// catalog do -- unlike console-ui.spec.ts, which needs the seeded anchor
// tenant.

test('the landing page previews the fleet and links to the rest', async ({ page }) => {
  await page.goto('/');

  const cards = page.getByRole('heading', { level: 3 });
  await expect(cards.first()).toBeVisible();
  // A shop window, not the catalog: at most six, then a way through.
  expect(await cards.count()).toBeLessThanOrEqual(6);

  const seeAll = page.getByRole('button', { name: /See all \d+ machines/ });
  if (await seeAll.isVisible()) {
    await seeAll.click();
    await expect(page).toHaveURL(/\/equipment$/);
  }
});

test('the catalog pages instead of rendering the whole fleet at once', async ({ page }) => {
  await page.goto('/equipment');
  await expect(page.getByRole('heading', { name: 'Equipment for hire' })).toBeVisible();

  const range = page.getByText(/Showing \d+-\d+ of \d+ machines/);
  // Controls hide themselves on a single page, so only assert paging when
  // there is a second page to reach.
  if (await range.isVisible()) {
    const first = await range.textContent();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(range).not.toHaveText(first ?? '');

    // Filtering down must not strand the reader on a page past the end of
    // the new, shorter result.
    await page.getByRole('searchbox').fill('zzzz-no-such-machine');
    await expect(page.getByText('No equipment matches that search.')).toBeVisible();
  }
});
