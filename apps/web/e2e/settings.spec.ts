import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';

// Needs the seeded anchor tenant and the API running. Writes to the seeded
// customer's own profile only.

test.describe('customer settings', () => {
  test('profile, picture, company, security and notification tabs', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/account/settings');

    // Profile: KYC name is read-only, contact details save.
    await expect(page.getByRole('tab', { name: 'Profile', selected: true })).toBeVisible();
    await expect(page.getByText('Legal name')).toBeVisible();
    const phone = page.getByLabel('Mobile number');
    await phone.fill('+63 917 000 1234');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Mobile number')).toHaveValue('+63 917 000 1234');

    // Picture: a real PNG, cut from the page itself.
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Profile picture updated')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Your profile picture' })).toBeVisible();

    await page.getByRole('tab', { name: 'Company' }).click();
    await expect(page.getByLabel('Billing address').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Security' }).click();
    await page.getByLabel(/^New password/).fill('short');
    await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toBeVisible();

    await page.getByRole('tab', { name: 'Notifications' }).click();
    const sms = page.getByRole('switch', { name: /SMS/ });
    const before = await sms.isChecked();
    await sms.click();
    await expect(sms).toBeChecked({ checked: !before });
    await sms.click(); // leave it as found
    await expect(sms).toBeChecked({ checked: before });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
