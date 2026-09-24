import { test, expect, type Browser, type Page } from '@playwright/test';
import { signIn } from './sign-in.js';

// Customer feedback round: crop the National ID, check what it says before
// upload, company fields that follow the uploaded papers, and an admin card
// that opens already read, with SEC/BIR/DTI registry links gating Verify.
//
// The documents are rendered here as clearly marked SPECIMEN papers with
// made-up numbers, so the spec runs against whatever OCR the API has: with
// extraction on, the fields arrive filled; with it off, they are typed.
// Needs the seeded anchor tenant and the API.

const PCN = '1234-5678-9012-3456';
const SEC = 'CS201912345';
const DTI = '3456789';

// A card-shaped ID on a wide desk background, so cropping has something to
// cut away.
const ID_HTML = `
<body style="margin:0;background:#8a7f72;width:1400px;height:900px;display:flex;align-items:center;justify-content:center;font-family:Arial">
  <div style="width:856px;height:540px;background:#eef3f8;border-radius:28px;padding:32px;box-sizing:border-box;position:relative">
    <div style="font-size:22px;font-weight:bold">REPUBLIKA NG PILIPINAS</div>
    <div style="font-size:18px">Republic of the Philippines</div>
    <div style="font-size:20px;margin-top:6px">PAMBANSANG PAGKAKAKILANLAN / Philippine Identification Card</div>
    <div style="font-size:30px;font-weight:bold;margin-top:18px;letter-spacing:2px">${PCN}</div>
    <div style="font-size:15px;margin-top:14px">Apelyido / Last Name</div><div style="font-size:24px;font-weight:bold">DELA CRUZ</div>
    <div style="font-size:15px;margin-top:6px">Mga Pangalan / Given Names</div><div style="font-size:24px;font-weight:bold">JUAN</div>
    <div style="font-size:15px;margin-top:6px">Gitnang Apelyido / Middle Name</div><div style="font-size:24px;font-weight:bold">MERCADO</div>
    <div style="display:flex;gap:40px;margin-top:6px">
      <div><div style="font-size:15px">Petsa ng Kapanganakan / Date of Birth</div><div style="font-size:22px;font-weight:bold">JANUARY 02, 1990</div></div>
      <div><div style="font-size:15px">Kasarian / Sex</div><div style="font-size:22px;font-weight:bold">MALE</div></div>
    </div>
    <div style="font-size:15px;margin-top:6px">Tirahan / Address</div><div style="font-size:18px;font-weight:bold">1 RIZAL ST, BRGY SAN ROQUE, QUEZON CITY</div>
    <div style="position:absolute;right:40px;top:200px;font-size:64px;color:rgba(200,0,0,.25);transform:rotate(-20deg)">SPECIMEN</div>
  </div>
</body>`;

const certificate = (title: string, lines: string[]) => `
<body style="margin:0;background:#fff;width:1000px;height:1300px;font-family:Georgia;padding:80px;box-sizing:border-box">
  <div style="text-align:center;font-size:22px">Republic of the Philippines</div>
  <div style="text-align:center;font-size:34px;font-weight:bold;margin:24px 0">${title}</div>
  ${lines.map((l) => `<div style="font-size:24px;margin:18px 0">${l}</div>`).join('')}
  <div style="margin-top:80px;font-size:72px;color:rgba(200,0,0,.25);text-align:center">SPECIMEN</div>
</body>`;

async function render(browser: Browser, html: string, width: number, height: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

// Letters only: a trailing timestamp reads as a separate low-confidence
// token and bounces the certificate as illegible.
const runTag = Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!).toUpperCase();
const STORAGE_UNAVAILABLE = Boolean(process.env.CI);
const companyName = `E2E Specimen Builders ${runTag}`;

// A fresh customer per run rather than the seeded one: this flow adds a
// company, and a login that owns several makes other specs pick one.
async function signUpCustomer(page: Page) {
  const email = `kyc-e2e-${Date.now()}@example.test`;
  const password = 'correct horse battery staple';
  const res = await page.request.post('/api/v1/auth/register-customer', {
    data: { email, password, acceptedTerms: true },
  });
  expect(res.ok(), `register-customer answered ${res.status()}`).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/account/, { timeout: 15_000 });
  // Let the post-login redirect settle, or it can land after the next goto.
  await page.waitForLoadState('networkidle');
}

test.describe.serial('KYC review: crop, ID check, per-document fields, registry-gated verify', () => {
  test.setTimeout(180_000);

  test('customer crops the ID, checks its details, and sees only the fields their papers carry', async ({
    page,
    browser,
  }) => {
    const idPng = await render(browser, ID_HTML, 1400, 900);
    const secPng = await render(
      browser,
      certificate('SECURITIES AND EXCHANGE COMMISSION<br>CERTIFICATE OF INCORPORATION', [
        `SEC Registration No. ${SEC}`,
        `Company Name: ${companyName.toUpperCase()}`,
        'Registered Address: 12 YARD ROAD, CEBU CITY',
        'Date of Registration: MARCH 4, 2019',
      ]),
      1000,
      1300,
    );
    const dtiPng = await render(
      browser,
      certificate('DEPARTMENT OF TRADE AND INDUSTRY<br>CERTIFICATE OF BUSINESS NAME REGISTRATION', [
        `Business Name No. ${DTI}`,
        `Business Name: ${companyName.toUpperCase()}`,
      ]),
      1000,
      1300,
    );
    const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

    await signUpCustomer(page);
    await page.goto('/account/companies/new');
    await expect(page.getByText(/Step 1 of 3/)).toBeVisible();

    // Step 1: the photo opens the cropper, free size first, then the card
    // shape and square on toggle.
    await page.getByTestId('doc-government_id-file').setInputFiles(file('id.png', idPng));
    const dialog = page.getByRole('dialog', { name: 'Crop your document' });
    await expect(dialog).toBeVisible();
    const shape = dialog.getByRole('radiogroup', { name: 'Crop shape' });
    await expect(shape.getByRole('radio', { name: 'Free' })).toHaveAttribute('aria-checked', 'true');
    const cropArea = dialog.locator('[data-testid="cropper"]');
    const ratio = async () => {
      const box = (await cropArea.boundingBox())!;
      return box.width / box.height;
    };
    // Free starts on the whole photo (1400 x 900) and resizes each side.
    await expect.poll(ratio).toBeCloseTo(1400 / 900, 1);
    await dialog.getByLabel('Height').fill('0.5');
    await expect.poll(ratio).toBeCloseTo(1400 / 450, 1);
    await shape.getByRole('radio', { name: 'ID card' }).click();
    await expect.poll(ratio).toBeCloseTo(85.6 / 54, 1);
    await shape.getByRole('radio', { name: 'Square' }).click();
    await expect.poll(ratio).toBeCloseTo(1, 1);
    await shape.getByRole('radio', { name: 'ID card' }).click();
    await expect.poll(ratio).toBeCloseTo(85.6 / 54, 1);
    await dialog.getByRole('button', { name: 'Use this crop' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Crop again' })).toBeVisible();

    // Step 2: the customer checks the ID details before going on.
    await page.getByRole('button', { name: 'Next: check your ID details' }).click();
    await expect(page.getByText(/Step 2 of 3/)).toBeVisible({ timeout: 60_000 });
    const pcn = page.getByLabel(/PCN/);
    const first = page.getByLabel('First name');
    const last = page.getByLabel('Last name');
    const read = (await pcn.inputValue()) !== '';
    test.info().annotations.push({ type: 'ocr', description: read ? 'ID read by OCR' : 'ID typed (OCR off or unread)' });
    if (read) {
      await expect(pcn).toHaveValue(PCN);
      await expect(last).toHaveValue(/DELA CRUZ/i);
    }
    await first.fill('Juan');
    await last.fill('Dela Cruz');
    // A malformed PCN never gets past this step.
    await pcn.fill('1234');
    await page.getByRole('button', { name: 'Next: company registration' }).click();
    await expect(page.getByText(/Step 2 of 3/)).toBeVisible();
    expect(await pcn.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    // Spaces are re-dashed on blur. One digit off the card, so the admin
    // card shows a customer edit when OCR is on.
    await pcn.fill('1234 5678 9012 3457');
    await pcn.blur();
    await expect(pcn).toHaveValue('1234-5678-9012-3457');
    await page.getByRole('button', { name: 'Next: company registration' }).click();

    // Step 3: SEC as the primary paper, DTI as the secondary.
    await expect(page.getByText(/Step 3 of 3/)).toBeVisible();
    await page.getByLabel('Document type').selectOption('sec_certificate');
    // Every photo opens the cropper, certificates included.
    await page.getByTestId('doc-company_registration-file').setInputFiles(file('sec.png', secPng));
    await page.getByRole('dialog', { name: 'Crop your document' }).getByRole('button', { name: 'Use this crop' }).click();
    await page.getByTestId('doc-dti_certificate-file').setInputFiles(file('dti.png', dtiPng));
    await page.getByRole('dialog', { name: 'Crop your document' }).getByRole('button', { name: 'Use this crop' }).click();
    await expect(page.getByRole('button', { name: 'Crop again' })).toHaveCount(2);
    await page.getByRole('button', { name: 'Next: check the details' }).click();

    // Only the numbers these papers print: no TIN without a 2303.
    await expect(page.getByLabel('Company name')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('TIN')).toHaveCount(0);
    const sec = page.getByLabel('SEC registration number');
    const dti = page.getByLabel('DTI business name number');
    await expect(sec).toBeVisible();
    await expect(dti).toBeVisible();
    // Each paper is its own scan (and its own rate-limit slot): assert a
    // read value only where that scan answered.
    if ((await sec.inputValue()) !== '') await expect(sec).toHaveValue(SEC);
    if ((await dti.inputValue()) !== '') await expect(dti).toHaveValue(DTI);
    await page.getByLabel('Company name').fill(companyName);
    await sec.fill(SEC);
    await dti.fill(DTI);
    await page.getByLabel('Complete billing address').fill('12 Yard Road, Cebu City');
    await page.getByLabel('Contact mobile').fill('+63 917 000 1234');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Submit' }).click();
    // Every paper uploaded: a failed upload still redirects, with a different
    // toast. CI's console-e2e job has no storage behind the API (ci.yml), so
    // uploads cannot land there; the toast is asserted wherever they can.
    if (!STORAGE_UNAVAILABLE) await expect(page.getByText('Company added')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/account\/applications/, { timeout: 60_000 });
    await expectNoHorizontalScroll(page);
  });

  test('admin sees the reads without clicking, and cannot verify until each registry is checked', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'admin console is a desktop workflow');
    test.skip(STORAGE_UNAVAILABLE, 'needs the uploaded documents; CI has no storage behind the API');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await page.goto('/app/registration/pending');
    const card = page.getByRole('group', { name: companyName });
    await expect(card.getByRole('heading', { name: companyName })).toBeVisible({ timeout: 30_000 });

    // Prefilled from what the customer confirmed; no Read click needed.
    await expect(card.getByLabel('First name')).toHaveValue('Juan');
    await expect(card.getByLabel('Last name')).toHaveValue('Dela Cruz');
    await expect(card.getByText('1234-5678-9012-3457')).toBeVisible();
    await expect(card.getByLabel('SEC registration number')).toHaveValue(SEC);
    await expect(card.getByLabel('DTI business name number')).toHaveValue(DTI);
    await expect(card.getByLabel('TIN')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Re-read National ID' })).toBeVisible();

    // The registry link copies the number and opens the search.
    const verify = card.getByRole('button', { name: 'Verify' });
    await expect(verify).toBeDisabled();
    // SEC takes the number; DTI's BNRS only an exact business name.
    for (const [registry, value, url] of [
      ['SEC', SEC, 'checkwithsec.sec.gov.ph'],
      ['DTI', companyName, 'bnrs.dti.gov.ph'],
    ] as const) {
      const popup = page.waitForEvent('popup');
      await card.getByRole('link', { name: new RegExp(`Check on ${registry}`) }).click();
      const tab = await popup;
      expect(tab.url()).toContain(url);
      await tab.close();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    }

    await card.getByLabel('I checked this on the SEC registry').check();
    await expect(verify).toBeDisabled();
    await card.getByLabel('I checked this on the DTI registry').check();
    await expect(verify).toBeEnabled();
    await verify.click();
    await expect(page.getByText('Company verified')).toBeVisible({ timeout: 30_000 });
  });
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

// The three public registries the admin links to: each must still load
// and still take what the review card copies (REGISTRY_LINKS). Nothing is
// submitted -- ORUS sits behind reCAPTCHA and SEC behind a Cloudflare bot
// check, by design, and none of these is ours to automate. A bot check or an
// unreachable site skips with the reason rather than failing the suite.
test.describe('@external registry pages', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop');
    test.setTimeout(120_000);
  });

  async function open(page: Page, url: string, registry: string) {
    const res = await page.goto(url, { waitUntil: 'commit', timeout: 90_000 }).catch((e: Error) => e);
    if (res instanceof Error || !res) test.skip(true, `${registry} unreachable: ${String(res)}`);
    else if ((await page.title().catch(() => '')).includes('Just a moment') || res.status() === 403)
      test.skip(true, `${registry} serves a bot check to headless browsers (${res.status()}); verify by hand`);
    else if (res.status() >= 400) test.skip(true, `${registry} answered ${res.status()}`);
  }

  test('SEC Check with SEC takes the pasted SEC number', async ({ page }) => {
    await open(page, 'https://checkwithsec.sec.gov.ph/check-with-sec/index', 'SEC');
    const box = page.locator('input[type="text"], input[type="search"], input:not([type])').first();
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill(SEC);
    await expect(box).toHaveValue(SEC);
  });

  test('BIR ORUS takes the TIN in three boxes plus the registered name', async ({ page }) => {
    await open(page, 'https://orus.bir.gov.ph/search/tinverification', 'BIR');
    await page.getByRole('radio', { name: 'Non-Individual', exact: true }).first().click({ timeout: 30_000 });
    const boxes = page.locator('input[type="tel"]');
    await expect(boxes).toHaveCount(3);
    for (const [i, group] of ['123', '456', '789'].entries()) await boxes.nth(i).fill(group);
    await expect(boxes.nth(2)).toHaveValue('789');
    const name = page.locator('input[type="text"]').first();
    await name.fill(companyName);
    await expect(name).toHaveValue(companyName);
  });

  test('DTI BNRS takes the pasted business name', async ({ page }) => {
    await open(page, 'https://bnrs.dti.gov.ph/search', 'DTI');
    const box = page.locator('input[name="keyword"]');
    await expect(box).toBeVisible({ timeout: 60_000 });
    await box.fill(companyName);
    await expect(box).toHaveValue(companyName);
  });
});
