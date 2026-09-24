import { test, expect, type Page } from '@playwright/test';
import { signIn, signInAsCustomer } from './sign-in.js';

// The self-loading truck as a bookable service (CR truck-booking-and-kyc-docs):
// dropdown locations -> estimate -> request -> negotiate -> staff accept a
// price -> My Bookings truck tab -> cash invoice -> staff record the cash.
// Needs the seeded anchor tenant, the API, and outbound access to the public
// OSM geocoder/router the estimate uses.

async function pickLocation(page: Page, label: string, city: string) {
  await page.getByLabel(`${label} region`).selectOption({ label: 'NCR (National Capital Region)' });
  await page.getByLabel(`${label} province`).selectOption({ label: 'Metro Manila' });
  await page.getByLabel(`${label} city or municipality`).selectOption({ label: city });
}

test.describe('self-loading truck', () => {
  test.setTimeout(180_000);

  test('request, negotiate, agree, pay cash, and staff record it', async ({ page: customer, browser }) => {
    await signInAsCustomer(customer);
    await customer.goto('/account/trucks');

    // Nothing to estimate until both cities are chosen.
    await expect(customer.getByRole('button', { name: 'Get estimate' })).toBeDisabled();
    await pickLocation(customer, 'Pickup location', 'City of Mandaluyong');
    await pickLocation(customer, 'Drop-off location', 'City of Muntinlupa');
    await customer.getByLabel('Pickup street or landmark (optional)').fill('SM Megamall loading bay');
    await customer.getByRole('button', { name: 'Get estimate' }).click();
    await expect(customer.getByText(/Estimate for about [\d.]+ km by road/)).toBeVisible({ timeout: 30_000 });

    const note = `e2e ${Date.now()}`;
    await customer.getByLabel('Notes (optional)').fill(note);
    await customer.getByRole('button', { name: 'Request truck' }).click();
    await expect(customer.getByText('Truck requested')).toBeVisible({ timeout: 30_000 });

    // The customer opens the negotiation with a counter-offer.
    const card = customer.getByRole('group').filter({ hasText: note });
    await card.getByRole('button', { name: 'Negotiate price' }).click();
    await card.getByLabel('Message').fill(`Can you do 4321? ${note}`);
    await card.getByLabel('Offer (PHP, optional)').fill('4321');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByText('Offer: ₱4,321.00')).toBeVisible();

    // Staff read the thread and accept the customer's number.
    const admin = await browser.newPage();
    await signIn(admin);
    await admin.goto('/app/trucks');
    const row = admin.locator('div', { hasText: note }).filter({ has: admin.getByLabel('Agreed price (PHP)') }).last();
    await row.getByRole('button', { name: 'Negotiation' }).click();
    await expect(row.getByText('Offer: ₱4,321.00')).toBeVisible();
    await row.getByLabel('Agreed price (PHP)').fill('4321');
    await row.getByRole('button', { name: 'Accept price' }).click();
    await expect(admin.getByText('Price accepted')).toBeVisible();

    // The customer finds it under My Bookings > Self-loading truck, agreed.
    await customer.goto('/account/bookings');
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    const booked = customer.getByRole('group').filter({ hasText: note });
    await expect(booked.getByText('₱4,321.00')).toBeVisible();
    await booked.getByRole('button', { name: 'Pay cash at the office' }).click();
    await expect(customer).toHaveURL(/\/account\/invoices\//, { timeout: 30_000 });
    await expect(customer.getByText('₱4,321.00').first()).toBeVisible();

    // Cash is settled only by staff, on the invoice.
    await admin.goto('/app/payments');
    await admin.getByRole('row', { name: /₱4,321\.00/ }).first().click();
    await admin.getByRole('button', { name: 'Record cash payment' }).click();
    await admin.getByRole('button', { name: 'Record payment' }).click();
    await expect(admin.getByText('Cash payment recorded')).toBeVisible();

    await customer.goto('/account/bookings');
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    await expect(customer.getByRole('group').filter({ hasText: note }).getByText(/Paid/)).toBeVisible();

    const overflow = await customer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
