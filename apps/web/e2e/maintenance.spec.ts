import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// Phase 2: an "Others" machine carries a free-text category, and logging a
// service resets that task's hours since service. The retire at the end is
// the cleanup, as in inventory-crud.spec.ts.
test('admin adds an Others machine, corrects its meter and logs a service that resets the hours', async ({
  page,
}) => {
  const serial = `E2E-MNT-${Date.now()}`;
  await signIn(page);
  await page.goto('/app/inventory');

  await page.getByRole('button', { name: 'Add equipment' }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Equipment name').fill('E2E Paver');
  await add.getByLabel('Category').selectOption({ label: 'Others' });
  // Required once "Others" is picked.
  await expect(add.getByRole('button', { name: 'Add equipment' })).toBeDisabled();
  await add.getByLabel('Describe the category').fill('Asphalt paver');
  await add.getByLabel('Serial / ID number').fill(serial);
  await add.getByRole('button', { name: 'Add equipment' }).click();
  await expect(add).toBeHidden();

  const card = page.getByRole('group', { name: serial });
  await card.getByRole('button', { name: 'Maintenance' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('No schedules yet.')).toBeVisible();

  // The Engine oil 250 h preset is the default.
  await dialog.getByRole('button', { name: 'Add schedule' }).click();
  const oil = dialog.getByRole('listitem', { name: 'Engine oil' });
  await expect(oil.getByTestId('hours-since')).toHaveText('0');

  await dialog.getByLabel('Meter reading (hours)').fill('120');
  await dialog.getByLabel('Reason').fill('Meter read on site');
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await expect(oil.getByTestId('hours-since')).toHaveText('120');

  await oil.getByRole('button', { name: 'Log service' }).click();
  await expect(oil.getByTestId('hours-since')).toHaveText('0');
  await expect(oil).toContainText('next due at 370 h');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete asset' }).click();
  await expect(page.getByRole('group', { name: serial })).toBeHidden();
});
