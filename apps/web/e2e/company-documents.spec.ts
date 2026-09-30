import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './sign-in.js';
import { choose } from './select.js';

// Needs the seeded anchor tenant (`pnpm db:seed`) and the API running.

const STORAGE_UNAVAILABLE = Boolean(process.env.CI);

test.describe('company documents', () => {
  // Each upload is an OCR read; three in a row can take a while.
  test.setTimeout(240_000);

  test('customer picks SEC as primary, adds DTI, and submits', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/account/companies/new');
    await expect(page.getByRole('dialog', { name: 'Add a company' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toHaveCount(0);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
    const file = (name: string) => ({ name, mimeType: 'image/png', buffer: png });

    // A scan that ran and read nothing stops the step; with OCR down the user types it instead.
    let ocrDown = false;
    await page.route('**/me/kyc/scan', (route) =>
      route.fulfill({
        json: { suggestions: {}, confidence: null, extractionAvailable: !ocrDown, layoutRecognized: null },
      }),
    );

    // Choose the ID before the camera opens.
    await choose(page.getByLabel('ID type'), 'philsys');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Capture the applicant's ID.
    await page.getByTestId('doc-government_id-file').setInputFiles(file('id.png'));
    await page.getByRole('button', { name: /Use scan|Use original photo/ }).click();
    await expect(page.getByText('Document not accepted')).toBeVisible();
    ocrDown = true;
    await page.getByTestId('doc-government_id-file').setInputFiles(file('id.png'));
    await page.getByRole('button', { name: /Use scan|Use original photo/ }).click();

    // Step 2: the customer confirms what the ID says.
    await page.getByLabel('First name').fill('Juan');
    await page.getByLabel('Last name').fill('Dela Cruz');
    await page.getByLabel(/PCN/).fill('1234-5678-9012-3456');
    await page.getByRole('button', { name: 'Next: registration type' }).click();

    // Choose the primary registration; DTI is never a primary document.
    const type = page.getByLabel('Registration type');
    await type.click();
    await expect(page.getByRole('option')).toHaveText([
      'BIR Certificate of Registration (Form 2303)',
      'SEC Certificate of Incorporation',
    ]);
    await page.keyboard.press('Escape');
    await choose(type, 'sec_certificate');
    await page.getByRole('button', { name: 'Continue' }).click();
    const next = page.getByRole('button', { name: 'Next: optional DTI certificate' });
    await expect(next).toBeDisabled();
    await page.getByTestId('doc-company_registration-file').setInputFiles(file('sec.png'));
    await page.getByRole('button', { name: /Use scan|Use original photo/ }).click();
    await page.getByTestId('doc-dti_certificate-file').setInputFiles(file('dti.png'));
    await page.getByRole('button', { name: /Use scan|Use original photo/ }).click();

    const name = `E2E Docs Corp ${Date.now()}`;
    await page.getByLabel('Company name').fill(name);
    // An SEC certificate carries an SEC number, not a TIN.
    await expect(page.getByLabel('TIN')).toHaveCount(0);
    await page.getByLabel('SEC registration number').fill('CS201912345');
    await page.getByLabel('Complete billing address').fill('1 Ayala Ave, Makati');
    await page.getByLabel('Contact mobile').fill('+63 917 000 1234');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Submit' }).click();
    // Wait for the uploads: navigating away mid-request would abort them.
    // CI's console-e2e job has no storage behind the API, so the upload
    // step (and everything after it) only runs locally.
    if (STORAGE_UNAVAILABLE) return;
    await expect(page.getByText('Company added')).toBeVisible({ timeout: 180_000 });

    await page.goto('/account/applications');
    await page.getByRole('group', { name }).getByRole('link', { name: /manage/i }).click();
    await expect(page.getByText('SEC Certificate of Incorporation')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('DTI Business Name (secondary)')).toBeVisible();
  });
});
