import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

// Phase 7: field logs are grouped by the rental they bill against, each
// group showing hours used and the deposit left, and collapsible.
test('field logs are grouped by rental with hours and deposit, and collapse', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/ocr');

  const group = page.getByTestId('rental-group').first();
  await expect(group).toBeVisible();
  await expect(group.getByTestId('rental-hours')).toContainText('used');
  await expect(group.getByTestId('rental-deposit')).toContainText('Deposit left');

  const rows = group.locator('table, [role="table"], ul').first();
  await expect(rows).toBeVisible();
  await group.locator('summary').click();
  await expect(rows).toBeHidden();
  await group.locator('summary').click();
  await expect(rows).toBeVisible();
});
