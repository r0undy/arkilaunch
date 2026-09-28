import { test, expect, type Page } from '@playwright/test';
import { signIn, signInAsCustomer } from './sign-in.js';
import { choose } from './select.js';

// The self-loading truck as a bookable service (CR truck-booking-and-kyc-docs):
// dropdown locations + map pins -> estimate range -> request -> request a
// call -> negotiate -> staff accept a price and confirm by phone -> My
// Bookings truck tab -> cash invoice -> staff record the cash.
// Needs the seeded anchor tenant, the API, and outbound access to the public
// OSM geocoder/router the estimate uses.

async function pickLocation(page: Page, label: string, city: string) {
  await choose(page.getByLabel(`${label} region`), { label: 'NCR (National Capital Region)' });
  await choose(page.getByLabel(`${label} province`), { label: 'Metro Manila' });
  await choose(page.getByLabel(`${label} city or municipality`), { label: city });
}

// The map is the booking screen: pick which pin, then tap right of the
// centre (clear of the floating panel on desktop, east of the bay). Works
// on the 3D map and on the flat fallback a browser without WebGL gets.
async function dropPin(page: Page, which: 'Pickup' | 'Drop-off', dx: number) {
  await page.getByRole('radio', { name: which, exact: true }).click();
  const map = page.getByRole('application').first();
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  const x = Math.min(box.width * 0.7 + dx, box.width - 20);
  await map.click({ position: { x, y: box.height / 3 } });
}

test.describe('self-loading truck', () => {
  test.setTimeout(180_000);

  test('pin, estimate range, request call, negotiate, agree, confirm by phone, pay cash', async ({ page: customer, browser }) => {
    await signInAsCustomer(customer);
    await customer.goto('/account/trucks');

    // Two taps: the route and price load with no button to press.
    await dropPin(customer, 'Pickup', 0);
    await dropPin(customer, 'Drop-off', 60);
    await expect(customer.getByText(/₱[\d,.]+ – ₱[\d,.]+/).first()).toBeVisible({ timeout: 30_000 });
    // The typed address waits under Advanced search.
    await customer.getByText('Advanced search').click();
    await pickLocation(customer, 'Pickup location', 'City of Mandaluyong');
    await pickLocation(customer, 'Drop-off location', 'City of Muntinlupa');
    await customer.getByLabel('Pickup street or landmark (optional)').fill('SM Megamall loading bay');
    await expect(customer.getByText(/Near-point estimate; tolls and route may change the final price, never above ₱[\d,.]+ without your OK\./).first()).toBeVisible();

    const note = `e2e ${Date.now()}`;
    await customer.getByLabel('Notes (optional)').fill(note);
    // The trip serves one of the customer's own sites, with its proof on
    // file (the seeded Demo Customer Site).
    const sitePicker = customer.getByLabel('Project site this trip serves');
    await choose(sitePicker, { label: 'Demo Customer Site' });
    await customer.getByRole('button', { name: 'Request truck' }).click();
    await expect(customer.getByText('Truck requested')).toBeVisible({ timeout: 30_000 });

    // The new trip opens in its drawer: the customer asks for the
    // confirming call, then counter-offers.
    const card = customer.getByRole('dialog').filter({ hasText: note });
    await card.getByRole('button', { name: 'Request call' }).click();
    await expect(card.getByText(/Call requested/)).toBeVisible();
    await card.getByLabel('Message').fill(`Can you do 4321? ${note}`);
    await card.getByLabel('Offer (PHP, optional)').fill('4321');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByText('Offer: ₱4,321.00')).toBeVisible();

    const code = (await card.getByText(/^TRK-\d{4}-\d{4}$/).first().textContent())!.trim();

    // Staff read the thread and accept the customer's number, in the
    // booking drawer.
    const admin = await browser.newPage();
    await signIn(admin);
    // Truck service lives under Bookings now; /app/trucks lands on its tab.
    await admin.goto('/app/trucks');
    await expect(admin.getByRole('tab', { name: /Truck service/ })).toHaveAttribute('aria-selected', 'true');
    // A table row on desktop, a card on a phone (Table, CR: console-components).
    await admin.locator('tr, li').filter({ hasText: code }).first().click();
    const drawer = admin.getByRole('dialog', { name: code });
    await drawer.getByRole('tab', { name: 'Negotiation' }).click();
    await expect(drawer.getByText('Offer: ₱4,321.00')).toBeVisible();
    await drawer.getByRole('tab', { name: 'Actions' }).click();
    await expect(drawer.getByText('The customer asked for a call')).toBeVisible();
    await drawer.getByLabel('Agreed price (PHP)').fill('4321');
    await drawer.getByRole('button', { name: 'Accept price' }).click();
    // Accepting a price asks first.
    await admin.getByRole('alertdialog', { name: 'Accept this price?' }).getByRole('button', { name: 'Accept price' }).click();
    await expect(admin.getByText('Price accepted')).toBeVisible();
    await drawer.getByRole('button', { name: 'Confirmed by phone' }).click();
    await admin.getByRole('alertdialog', { name: 'Mark as confirmed by phone?' }).getByRole('button', { name: 'Yes, we spoke' }).click();
    await expect(admin.getByText('Confirmed by phone').first()).toBeVisible();

    // The customer finds it under My Bookings > Self-loading truck, agreed.
    await customer.goto('/account/bookings');
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    const trip = customer.getByRole('button', { name: new RegExp(`^Trip ${code}`) });
    await expect(trip.getByText('₱4,321.00')).toBeVisible();
    await trip.click();
    const booked = customer.getByRole('dialog', { name: code });
    // Above the estimate's cap only the customer can lift it.
    const approve = booked.getByRole('button', { name: /^Approve / });
    if (await approve.isVisible()) await approve.click();
    await booked.getByRole('button', { name: 'Pay cash at the office' }).click();
    await expect(customer).toHaveURL(/\/account\/invoices\//, { timeout: 30_000 });
    await expect(customer.getByText('₱4,321.00').first()).toBeVisible();

    // Cash is settled only by staff, on the invoice.
    await admin.goto('/app/payments');
    await admin.locator('tr, li').filter({ hasText: '₱4,321.00' }).first().click();
    await admin.getByRole('button', { name: 'Record cash payment' }).click();
    await admin.getByRole('button', { name: 'Record payment' }).click();
    await expect(admin.getByText('Cash payment recorded')).toBeVisible();

    await customer.goto('/account/bookings');
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    await expect(customer.getByRole('button', { name: new RegExp(`^Trip ${code}`) }).getByText('Paid', { exact: true })).toBeVisible();

    const overflow = await customer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
