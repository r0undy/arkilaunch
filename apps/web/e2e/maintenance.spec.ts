import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';
import { choose } from './select.js';

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
  await choose(add.getByLabel('Category'), { label: 'Others' });
  // Required once "Others" is picked.
  await expect(add.getByRole('button', { name: 'Add equipment' })).toBeDisabled();
  await add.getByLabel('Describe the category').fill('Asphalt paver');
  await add.getByLabel('Serial / ID number').fill(serial);
  await add.getByRole('button', { name: 'Add equipment' }).click();
  await expect(add).toBeHidden();

  // The fleet is paged and sorted by category: once other specs have added
  // units, a new "Others" machine can land past page one. Find it by serial.
  await page.getByLabel('Search').fill(serial);
  const card = page.getByRole('group', { name: serial });
  await card.getByRole('button', { name: 'Report & maintenance' }).click();
  const dialog = page.getByRole('dialog', { name: 'E2E Paver' });
  // Opens on the unit's report; schedules are the second tab.
  await expect(dialog.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('tab', { name: /^Schedules/ }).click();
  await expect(dialog.getByText('No schedules yet.')).toBeVisible();

  // The Engine oil 250 h preset is the default.
  await dialog.getByRole('button', { name: 'Add schedule' }).click();
  const oil = dialog.getByRole('listitem', { name: 'Engine oil' });
  await expect(oil.getByTestId('hours-since')).toHaveText('0');

  await dialog.getByRole('button', { name: 'Correct hour meter' }).click();
  const meter = page.getByRole('dialog', { name: 'Correct hour meter' });
  await meter.getByLabel('Meter reading (hours)').fill('120');
  await meter.getByLabel('Reason').fill('Meter read on site');
  await meter.getByRole('button', { name: 'Save reading' }).click();
  await expect(meter).toBeHidden();
  await expect(oil.getByTestId('hours-since')).toHaveText('120');

  await oil.getByRole('button', { name: 'Log service' }).click();
  await expect(oil.getByTestId('hours-since')).toHaveText('0');
  await expect(oil).toContainText('next due at 370 h');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete asset' }).click();
  await expect(page.getByRole('group', { name: serial })).toBeHidden();
});
