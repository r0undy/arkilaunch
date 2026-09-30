import { test, expect } from '@playwright/test';
import { makeToken, makeValidClaims } from '../src/test/make-token.js';

// All API traffic is intercepted: no seeded account or database writes.
const id = '11111111-1111-4111-8111-111111111111';
const quoteId = '55555555-5555-4555-8555-555555555555';
const customerId = '33333333-3333-4333-8333-333333333333';
const quote = {
  id: quoteId, revision: 2, status: 'accepted', total: 19500, subtotal: 21000, discount: 1500,
  mobilization: 2000, demobilization: 1000,
  lineItems: [{ kind: 'equipment', equipmentTypeId: id, equipmentTypeName: 'Excavator', quantity: 1,
    estimatedHours: 40, rentParts: [], rent: 18000, hourlyRate: 450, operatingCost: 18000, buffer: 0, subtotal: 18000 }],
};
const booking = {
  id, code: 'EQR-2026-0001', status: 'pending', projectSiteId: id, siteCity: 'Pasig', siteProvince: null,
  trackerUrl: '/orders/x', customerId, createdAt: '2026-09-01T00:00:00Z',
  items: [{ id, equipmentId: id, equipmentName: 'Excavator / CAT 320D / SN TEST-001',
    start: '2026-10-01T08:00:00Z', end: '2026-10-05T17:00:00Z', status: 'scheduled' }],
  quotation: { id: quoteId, revision: 2, status: 'accepted', totalPhp: 19500, createdAt: '2026-09-02T00:00:00Z' },
  deposit: { required: null, totalDeducted: 0, deductions: [] }, changeRequests: [], invoices: [], payments: [],
};

for (const width of [1440, 360]) {
  test('itemized booking costs and rental days fit at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const claims = makeValidClaims({ role: 'customer' });
    await page.addInitScript((userId) => {
      sessionStorage.setItem('arkilaunch.refreshToken', 'mock-refresh');
      sessionStorage.setItem('arkilaunch.tabUser', userId);
      localStorage.setItem('arkilaunch.sessionOwner', userId);
    }, claims.sub as string);
    const accessToken = makeToken(claims);
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = [];
      if (path.endsWith('/auth/refresh')) json = { accessToken, refreshToken: 'mock-refresh' };
      else if (path.endsWith('/catalog/tenant')) json = { name: 'Almara', slug: 'almara' };
      else if (path.endsWith('/users/me')) json = { id: claims.sub, role: 'customer', tenantName: 'Almara' };
      else if (path.endsWith('/bookings/' + id)) json = booking;
      else if (path.endsWith('/quotes/' + quoteId)) json = quote;
      await route.fulfill({ status: 200, json });
    });
    await page.goto('/account/bookings/' + id);
    await expect(page.getByRole('heading', { name: 'Equipment cost breakdown' })).toBeVisible();
    const lines = page.getByRole('list', { name: 'Quote line items' });
    await expect(lines.getByText('40 quoted billable hours per unit')).toBeVisible();
    await expect(lines).toContainText('18,000');
    await expect(page.getByText('Discount', { exact: true })).toBeVisible();
    await expect(page.getByText('5 rental days', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
