import { expect, test } from '@playwright/test';
import { platformUrl } from './sign-in.js';

// ArkiLaunch's own landing page on the bare platform host.
test.describe('platform landing', () => {
  test('shows ArkiLaunch, not a tenant, and leads to registration', async ({ page }) => {
    await page.goto(platformUrl('/'));
    await expect(page.getByRole('heading', { level: 1, name: /launch your equipment rental business/i })).toBeVisible();
    await expect(page.getByText('Almara', { exact: true })).toHaveCount(0);

    await page.getByLabel('Your company name').fill('Bayani Heavy Rentals');
    await expect(page.getByText('bayani-heavy-rentals', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Claim this address' }).click();
    await expect(page).toHaveURL(platformUrl('/register'));
  });

  test('has a rental company directory whose filters live in the URL', async ({ page }) => {
    await page.goto(platformUrl('/'));
    await expect(page.getByRole('heading', { name: 'Find a rental company' })).toBeVisible();
    await page.getByLabel('City or province').fill('Cebu');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/location=Cebu/);
  });

  test('fits a phone screen with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(platformUrl('/'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('an unknown tenant host says so', async ({ page }) => {
    const url = new URL(platformUrl('/'));
    url.hostname = `no-such-company.${url.hostname}`;
    await page.goto(url.toString());
    await expect(page.getByRole('heading', { name: 'Rental company not found' })).toBeVisible();
  });
});
