import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';
import { choose } from './select.js';

// One journey so the retire is the cleanup. The serial carries the run's timestamp: serials are unique per tenant.

test('a machine can be added, edited and retired from the inventory', async ({ page }) => {
  const serial = `E2E-${Date.now()}`;

  await signIn(page);
  await page.goto('/app/inventory');

  // --- add ---------------------------------------------------------------
  await page.getByRole('button', { name: 'Add equipment' }).click();
  const addDialog = page.getByRole('dialog');
  await expect(addDialog).toBeVisible();

  await addDialog.getByLabel('Equipment name').fill('E2E Backhoe');
  // The first real option; index 0 is the "Choose a category" placeholder.
  await choose(addDialog.getByLabel('Category'), { index: 1 });
  await addDialog.getByLabel('Serial / ID number').fill(serial);
  await addDialog.getByLabel('Weight / capacity (tons)').fill('22.5');
  await choose(addDialog.getByLabel('Fuel type'), { label: 'Diesel' });
  await addDialog.getByRole('button', { name: 'Add equipment' }).click();

  await expect(addDialog).toBeHidden();
  // The card is named by its serial, so the machine can be found by the one
  // value that is unique to this run.
  const card = page.getByRole('group', { name: serial });
  await expect(card).toBeVisible();
  await expect(card.getByText('E2E Backhoe')).toBeVisible();

  // --- edit --------------------------------------------------------------
  await card.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog).toBeVisible();

  // The serial is immutable: UPDATE on the column is revoked.
  await expect(editDialog.getByLabel('Serial / ID number')).toBeDisabled();

  await editDialog.getByLabel('Equipment name').fill('E2E Backhoe II');
  await editDialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(editDialog).toBeHidden();
  await expect(card.getByText('E2E Backhoe II')).toBeVisible();

  // --- retire ------------------------------------------------------------
  await card.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: 'Delete Asset?' })).toBeVisible();
  // The confirm must not repeat the frame's promise to destroy the logs.
  await expect(confirm.getByText(/history, field logs and the invoices they priced are kept/i))
    .toBeVisible();

  await confirm.getByRole('button', { name: 'Delete asset' }).click();

  // Retired, not deleted: gone from every bookable surface.
  await expect(page.getByRole('group', { name: serial })).toBeHidden();
});
