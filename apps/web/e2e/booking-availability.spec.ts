import { test, expect } from '@playwright/test';
import { signInAsCustomer, TENANT_HEADERS } from './sign-in.js';

// The blocked window is removed afterwards so no other spec inherits it.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test('booking disables taken dates', async ({ page }) => {
  await signInAsCustomer(page);
  await page.goto('/equipment');
  await page.locator('h3 button').first().click();
  await expect(page).toHaveURL(/\/equipment\/[0-9a-f-]{36}/);
  const equipmentId = page.url().split('/equipment/')[1]!.split(/[?#]/)[0]!;

  const login = await page.request.post('/api/v1/auth/login', {
    data: { email: ADMIN_EMAIL, password: PASSWORD },
    headers: TENANT_HEADERS,
  });
  expect(login.ok(), `admin login answered ${login.status()}`).toBe(true);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d;
  };
  // Keep pickup and return on open weekdays regardless of when CI runs.
  const pickupOffset = Array.from({ length: 7 }, (_, n) => 14 + n).find((offset) => day(offset).getDay() === 1)!;
  const pickup = day(pickupOffset);
  const blocked = [day(pickupOffset + 1), day(pickupOffset + 2)];
  const freeStart = day(pickupOffset + 3);
  const freeEnd = day(pickupOffset + 4);
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
    await page.getByRole('button', { name: /rent/i }).first().click();
    const dialog = page.getByRole('dialog');
    const calendar = dialog.getByRole('group', { name: /^Rental dates/ });
    await expect(calendar).toBeVisible();
    const cell = (d: Date) => calendar.locator(`[data-date="${localDate(d)}"]`);
    for (let i = 0; i < 3 && (await cell(blocked[1]!).count()) === 0; i++) {
      await dialog.getByRole('button', { name: 'Next month' }).click();
    }

    for (const d of blocked) {
      await expect(cell(d)).toBeDisabled();
      await expect(cell(d)).toHaveAttribute('aria-label', /Maintenance/);
    }
    const free = cell(freeStart);
    await expect(free).toBeEnabled();

    // Picking a window across the blocked days is refused before submit.
    async function chooseRentalDay(label: 'Rental start' | 'Rental end', target: Date) {
      await dialog.getByLabel(label).click();
      const picker = page.getByRole('dialog', { name: `Choose ${label.toLowerCase()}` });
      const targetMonth = target.toLocaleDateString('en-PH', { month: 'long' });
      if ((await picker.getByRole('combobox', { name: 'Month' }).textContent())?.trim() !== targetMonth) {
        await picker.getByRole('button', { name: 'Next month' }).click();
      }
      await picker.locator(`[data-calendar-day="${localDate(target)}"]`).click();
      await picker.getByRole('button', { name: 'Select date' }).click();
    }
    await chooseRentalDay('Rental start', pickup);
    await chooseRentalDay('Rental end', freeStart);
    await expect(dialog.getByText(/is not available/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add to cart' })).toBeDisabled();

    // A free range picked on the calendar clears it.
    await free.click();
    await cell(freeEnd).click();
    await expect(dialog.getByText(/is not available/)).toBeHidden();
    await expect(free).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(freeEnd)).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await page.request.delete(`/api/v1/equipment/${equipmentId}/maintenance-windows/${windowId}`, { headers });
  }
});
