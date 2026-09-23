import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// End-to-end cover for the inventory CRUD surface (Figma 292:1344,
// 293:2668, 293:3256) against the real fleet endpoints.
//
// One test, one round trip: a machine is added, edited, and retired. Split
// into three tests it would need three fixtures and leave two orphans in the
// seeded tenant every run; as one journey it cleans up after itself, because
// the retire IS the cleanup.
//
// The serial carries the run's timestamp: serials are unique per tenant, so
// a fixed one would 409 on the second run against the same database.

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
  await addDialog.getByLabel('Category').selectOption({ index: 1 });
  await addDialog.getByLabel('Serial / ID number').fill(serial);
  await addDialog.getByLabel('Weight / capacity (tons)').fill('22.5');
  await addDialog.getByLabel('Fuel type').selectOption('Diesel');
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

  // The serial is immutable once recorded -- migration 0026 REVOKEs UPDATE
  // on the column, so the field must not offer to change it.
  await expect(editDialog.getByLabel('Serial / ID number')).toBeDisabled();

  await editDialog.getByLabel('Equipment name').fill('E2E Backhoe II');
  await editDialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(editDialog).toBeHidden();
  await expect(card.getByText('E2E Backhoe II')).toBeVisible();

  // --- retire ------------------------------------------------------------
  await card.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: 'Delete Asset?' })).toBeVisible();
  // The confirm must not repeat the frame's promise to destroy the logs.
  await expect(confirm.getByText(/history, field logs and the invoices they priced are kept/i))
    .toBeVisible();

  await confirm.getByRole('button', { name: 'Delete asset' }).click();

  // Gone from the fleet list. It still exists in the database -- a retire is
  // not a delete -- but it has left every surface a machine can be booked
  // from.
  await expect(page.getByRole('group', { name: serial })).toBeHidden();
});
