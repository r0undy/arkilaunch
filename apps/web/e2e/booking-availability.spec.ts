import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';

// Phase 3: the rent dialog greys the days a unit cannot take. The admin
// blocks two maintenance days on the first catalog unit through the API,
// the customer sees exactly those days disabled, and the window is removed
// afterwards so no other spec inherits it.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test('booking disables taken dates', async ({ page }) => {
  await signInAsCustomer(page);
  await page.goto('/equipment');
  // The machine name on the first card links to its detail page (and id).
  await page.locator('h3 button').first().click();
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}/);
  const equipmentId = page.url().split('/equipment/')[1]!.split(/[?#]/)[0]!;

  const login = await page.request.post('/api/v1/auth/login', { data: { email: ADMIN_EMAIL, password: PASSWORD } });
  expect(login.ok(), `admin login answered ${login.status()}`).toBe(true);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  };
  const blocked = [day(20), day(21)];
  const startsAt = new Date(blocked[0]!);
  startsAt.setHours(9, 0, 0, 0);
  const endsAt = new Date(blocked[1]!);
  endsAt.setHours(15, 0, 0, 0);
  const created = await page.request.post(`/api/v1/equipment/${equipmentId}/maintenance-windows`, {
    headers,
    data: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), notes: 'e2e availability' },
  });
  expect(created.ok(), `maintenance window answered ${created.status()}`).toBe(true);
  const { id: windowId } = (await created.json()) as { id: string };

  try {
    await page.goto('/equipment');
    const card = page.locator('h3 button').first();
    await expect(card).toBeVisible();
    // Same first card; its Rent button opens the dialog.
    await page.getByRole('button', { name: /rent/i }).first().click();
    const dialog = page.getByRole('dialog');
    const grid = dialog.getByRole('group', { name: 'Available dates' });
    await expect(grid).toBeVisible();

    for (const d of blocked) {
      await expect(grid.getByRole('button', { name: `${localDate(d)} Maintenance` })).toBeDisabled();
    }
    const free = grid.getByRole('button', { name: localDate(day(25)), exact: true });
    await expect(free).toBeEnabled();

    // Picking a window across the blocked days is refused before submit.
    await dialog.getByLabel('Rental start').fill(`${localDate(day(19))}T08:00`);
    await dialog.getByLabel('Rental end').fill(`${localDate(day(22))}T17:00`);
    await expect(dialog.getByText(/is not available/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add to cart' })).toBeDisabled();

    // A free day from the grid clears it.
    await free.click();
    await expect(dialog.getByText(/is not available/)).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  } finally {
    await page.request.delete(`/api/v1/equipment/${equipmentId}/maintenance-windows/${windowId}`, { headers });
  }
});
