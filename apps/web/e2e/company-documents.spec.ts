import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';

// CR truck-booking-and-kyc-docs: the primary registration is a BIR COR or an
// SEC certificate picked from a dropdown; DTI is optional and secondary.
// Needs the seeded anchor tenant and the API.

test.describe('company documents', () => {
  test.setTimeout(90_000);

  test('customer picks SEC as primary, adds DTI, and submits', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/account/companies/new');
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
    const file = (name: string) => ({ name, mimeType: 'image/png', buffer: png });

    // Step 1: the applicant's ID.
    await page.getByTestId('doc-government_id-file').setInputFiles(file('id.png'));
    await page.getByRole('button', { name: 'Skip cropping' }).click();
    await page.getByRole('button', { name: 'Next: check your ID details' }).click();

    // Step 2: the customer confirms what the ID says.
    await page.getByLabel('First name').fill('Juan');
    await page.getByLabel('Last name').fill('Dela Cruz');
    await page.getByLabel(/PCN/).fill('1234-5678-9012-3456');
    await page.getByRole('button', { name: 'Next: company registration' }).click();

    // Step 2: the dropdown offers exactly BIR and SEC; DTI is never primary.
    const type = page.getByLabel('Document type');
    await expect(type.locator('option')).toHaveText([
      'BIR Certificate of Registration (Form 2303)',
      'SEC Certificate of Incorporation',
    ]);
    const next = page.getByRole('button', { name: 'Next: check the details' });
    // DTI alone cannot move the application on.
    await page.getByTestId('doc-dti_certificate-file').setInputFiles(file('dti.png'));
    await page.getByRole('button', { name: 'Skip cropping' }).click();
    await expect(next).toBeDisabled();

    await type.selectOption('sec_certificate');
    await page.getByTestId('doc-company_registration-file').setInputFiles(file('sec.png'));
    await page.getByRole('button', { name: 'Skip cropping' }).click();
    await expect(next).toBeEnabled();
    await next.click();

    const name = `E2E Docs Corp ${Date.now()}`;
    await page.getByLabel('Company name').fill(name);
    // An SEC certificate carries an SEC number, not a TIN.
    await expect(page.getByLabel('TIN')).toHaveCount(0);
    await page.getByLabel('SEC registration number').fill('CS201912345');
    await page.getByLabel('Complete billing address').fill('1 Ayala Ave, Makati');
    await page.getByLabel('Contact mobile').fill('+63 917 000 1234');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Submit' }).click();

    // The company page lists each document under its own type.
    await page.goto('/account/applications');
    await page.getByRole('group', { name }).getByRole('link', { name: /manage/i }).click();
    await expect(page.getByText('SEC Certificate of Incorporation')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('DTI Business Name (secondary)')).toBeVisible();
  });
});
