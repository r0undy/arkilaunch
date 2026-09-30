import { test, expect, type Page } from '@playwright/test';
import { signIn, signInAsCustomer } from './sign-in.js';
import { choose } from './select.js';

// Needs the seeded anchor tenant, the API, and outbound access to the public OSM geocoder/router.

async function pickLocation(page: Page, label: string, city: string) {
  await choose(page.getByLabel(`${label} region`), { label: 'NCR (National Capital Region)' });
  await choose(page.getByLabel(`${label} province`), { label: 'Metro Manila' });
  await choose(page.getByLabel(`${label} city or municipality`), { label: city });
}

// The map is the booking screen: pick which pin, then tap right of the
// centre (clear of the floating panel on desktop, east of the bay). Works
// on the 3D map and on the flat fallback a browser without WebGL gets.
async function dropPin(page: Page, which: 'Pickup' | 'Drop-off', dx: number) {
  const selector = page.getByRole('radio', { name: which, exact: true });
  if (await selector.isVisible()) await selector.click();
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
    await expect(customer.getByText('Trip details', { exact: true })).toHaveCount(0);
    await expect(customer.getByLabel('Equipment to load')).toHaveCount(0);

    // Two taps: the route and price load with no button to press.
    await dropPin(customer, 'Pickup', 0);
    await expect(customer.getByText('Trip details', { exact: true })).toHaveCount(0);
    await dropPin(customer, 'Drop-off', 60);
    const tripDetails = customer.getByRole('dialog', { name: 'Trip details' });
    await expect(tripDetails).toBeVisible();
    await tripDetails.getByRole('button', { name: 'Close' }).click();
    await expect(customer.getByLabel('Equipment to load')).toHaveCount(0);
    await customer.getByRole('button', { name: 'Trip details' }).click();
    await expect(tripDetails).toBeVisible();
    await expect(customer.getByLabel('Equipment to load')).toBeVisible();
    await expect(customer.getByText(/₱[\d,.]+ – ₱[\d,.]+/).first()).toBeVisible({ timeout: 30_000 });
    // The typed address waits under Advanced search.
    await customer.getByText('Advanced search').click();
    await pickLocation(customer, 'Pickup location', 'City of Mandaluyong');
    await pickLocation(customer, 'Drop-off location', 'City of Muntinlupa');
    await customer.getByLabel('Pickup street or landmark (optional)').fill('SM Megamall loading bay');
    await expect(customer.getByText(/Near-point estimate; the rental team confirms the km and tolls/).first()).toBeVisible();

    const note = `e2e ${Date.now()}`;
    await customer.getByLabel('Notes (optional)').fill(note);
    // The trip is for the customer's company; a site is optional and needs no proof. What goes on the truck is required.
    await customer.getByLabel('Equipment to load').fill('1 excavator, about 20 t');
    await customer.getByRole('button', { name: 'Request truck' }).click();
    await expect(customer.getByText('Truck requested')).toBeVisible({ timeout: 30_000 });

    // The new trip opens in its drawer: the customer asks for the
    // confirming call, then counter-offers.
    const card = customer.getByRole('dialog').filter({ hasText: note });
    await card.getByRole('button', { name: 'Request call' }).click();
    await expect(card.getByText(/Call requested/)).toBeVisible();
    await card.getByLabel('Message').fill(`Can you do 4321? ${note}`);
    await card.getByLabel('Counter-offer (PHP, optional)').fill('4321');
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
    // A table row on desktop, a card on a phone.
    await admin.locator('tr, li').filter({ hasText: code }).first().click();
    const drawer = admin.getByRole('dialog', { name: code });
    await drawer.getByRole('tab', { name: 'Negotiation' }).click();
    await expect(drawer.getByText('Offer: ₱4,321.00')).toBeVisible();
    await drawer.getByRole('tab', { name: 'Actions' }).click();
    await expect(drawer.getByText('The customer asked for a call')).toBeVisible();
    await expect(drawer.getByText('1 excavator, about 20 t')).toBeVisible();
    await drawer.getByLabel('Agreed price (PHP)').fill('4321');
    await drawer.getByRole('button', { name: 'Set agreed price' }).click();
    // Setting a price asks first.
    await admin.getByRole('alertdialog', { name: 'Set the agreed price?' }).getByRole('button', { name: 'Set price' }).click();
    await expect(admin.getByText('Price set')).toBeVisible();
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
    // The customer accepts every agreed price before paying.
    await booked.getByRole('button', { name: 'Accept ₱4,321.00' }).click();
    await booked.getByRole('button', { name: 'Pay cash at the office' }).click();
    await expect(customer).toHaveURL(/\/account\/invoices\//, { timeout: 30_000 });
    await expect(customer.getByText('₱4,321.00').filter({ visible: true }).first()).toBeVisible();

    // Cash is settled only by staff, on the invoice.
    await admin.goto('/app/payments');
    await admin.locator('tr, li').filter({ hasText: '₱4,321.00' }).first().click();
    await admin.getByRole('button', { name: 'Record cash payment' }).click();
    await admin.getByRole('button', { name: 'Record payment' }).click();
    await expect(admin.getByText('Cash payment recorded')).toBeVisible();

    await customer.goto('/account/bookings');
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    await expect(customer.getByRole('button', { name: new RegExp(`^Trip ${code}`) }).getByText('Paid', { exact: true })).toBeVisible();

    // Staff dispatches the paid truck; the customer sees the stored ETA.
    await admin.goto('/app/trucks');
    await admin.locator('tr, li').filter({ hasText: code }).first().click();
    const dispatchDrawer = admin.getByRole('dialog', { name: code });
    await dispatchDrawer.getByRole('tab', { name: 'Actions' }).click();
    await dispatchDrawer.getByRole('button', { name: 'Dispatch truck' }).click();
    await expect(admin.getByText('Truck dispatched')).toBeVisible({ timeout: 60_000 });
    await customer.reload();
    await customer.getByRole('tab', { name: 'Self-loading truck' }).click();
    await customer.getByRole('button', { name: new RegExp(`^Trip ${code}`) }).click();
    await expect(customer.getByRole('dialog', { name: code }).getByText(/Est\. arrival/)).toBeVisible();

    const overflow = await customer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
