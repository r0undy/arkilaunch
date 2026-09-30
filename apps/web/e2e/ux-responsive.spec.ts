import { test, expect } from '@playwright/test';
import { platformUrl, signIn, signInAsCustomer } from './sign-in.js';

test('operations screens fit phone, tablet and desktop widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  const screens = [
    { path: '/app/ocr', title: 'Field logs', slug: 'field-logs' },
    { path: '/app/users', title: 'People', slug: 'people' },
    { path: '/app/inventory', title: 'Equipment', slug: 'equipment' },
    { path: '/app/incidents', title: 'Incidents', slug: 'incidents' },
  ];
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { name: screen.title, exact: true }).first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      if (screen.slug === 'field-logs') await expect(page.getByTestId('rental-group').first()).toBeVisible();
      if (screen.slug === 'equipment') await expect(page.getByRole('heading', { name: /Excavator/i }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      if (width === 360 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`${screen.slug}-${width}.png`), fullPage: true });
      }
    }
  }
});

test('public and customer surfaces fit a phone viewport', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [platformUrl('/'), '/equipment']) {
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  await signInAsCustomer(page);
  await page.goto('/account/cart');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('customer-cart-360.png'), fullPage: true });
});

test('calendar dialog fits phone and desktop widths', async ({ page }, testInfo) => {
  await signIn(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app/ocr');
    await page.getByRole('button', { name: 'Record a field log' }).click();
    await page.getByRole('button', { name: /day worked/i }).click();
    await expect(page.getByRole('dialog', { name: 'Choose day worked' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`calendar-${width}.png`) });
  }
});

test('row action menus stay reachable on a phone', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/app/users');
  await expect(page.getByText('admin@admin.com').first()).toBeVisible();
  await page.getByRole('button', { name: /more actions for admin@admin.com/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Reset password' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/app/inventory');
  await expect(page.getByRole('heading', { name: /Excavator/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /more actions for/i }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Retire equipment' })).toBeVisible();
});
