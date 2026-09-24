import { test, expect } from '@playwright/test';
import { signIn, signInAsCustomer } from './sign-in.js';

// Needs the seeded anchor tenant, the API, and outbound access to the public
// OSM geocoder/router the estimate uses.

test.describe('self-loading truck', () => {
  test.setTimeout(90_000);

  test('customer gets an estimate and requests; admin confirms the km', async ({ page: customer, browser }) => {
    await signInAsCustomer(customer);
    await customer.goto('/account/trucks');
    await customer.getByLabel('Pickup location').fill('SM Megamall, Mandaluyong');
    await customer.getByLabel('Drop-off location').fill('Alabang Town Center, Muntinlupa');
    await customer.getByRole('button', { name: 'Get estimate' }).click();
    await expect(customer.getByText(/Estimate for about [\d.]+ km by road/)).toBeVisible({ timeout: 30_000 });
    await expect(customer.getByText("Driver's fee")).toBeVisible();

    const note = `e2e ${Date.now()}`;
    await customer.getByLabel('Notes (optional)').fill(note);
    await customer.getByRole('button', { name: 'Request truck' }).click();
    await expect(customer.getByText('Truck requested')).toBeVisible({ timeout: 30_000 });
    await expect(customer.getByText(/estimated$/).first()).toBeVisible();

    const overflow = await customer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const admin = await browser.newPage();
    await signIn(admin);
    await admin.goto('/app/trucks');
    await expect(admin.getByRole('heading', { name: 'Truck pricing' })).toBeVisible();
    const row = admin.locator('div', { hasText: note }).filter({ has: admin.getByLabel('Confirmed km') }).last();
    await row.getByLabel('Confirmed km').fill('30');
    await row.getByRole('button', { name: 'Confirm km' }).click();
    await expect(admin.getByText('Distance confirmed')).toBeVisible();

    await customer.reload();
    await expect(customer.getByText('30 km confirmed').first()).toBeVisible();
  });
});
