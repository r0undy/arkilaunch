import { expect, type Page } from '@playwright/test';

// The authed specs used to soft-skip when sign-in did not take:
//
//   test.skip(!(await signIn(page)), 'needs the seeded anchor tenant ...')
//
// which meant the whole console suite reported green on a machine with no
// API and no seed -- including in any CI job that ever ran it. A test that
// cannot fail is not cover. This throws instead, and the `console-e2e` CI
// job exists so the suite has somewhere it is guaranteed to run.
//
// Needs `pnpm db:seed` (the anchor tenant and its five RBAC accounts) and
// the API up. SEED_PASSWORD overrides the seeded default.

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@admin.com';
const CUSTOMER_EMAIL = process.env.SEED_CUSTOMER_EMAIL ?? 'customer@admin.com';
const PLATFORM_EMAIL = process.env.SEED_PLATFORM_EMAIL ?? 'platform@admin.com';
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

// The ArkiLaunch platform host: the tenant base URL minus its tenant label
// (https://almara.localhost:5173 -> https://localhost:5173).
export function platformUrl(path: string): string {
  const base = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'https://almara.localhost:5173');
  base.hostname = base.hostname.split('.').slice(1).join('.');
  return new URL(path, base).toString();
}

async function submit(page: Page, email: string, loginUrl = '/login') {
  await page.goto(loginUrl);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signIn(page: Page): Promise<void> {
  await submit(page, EMAIL);
  await expect(
    page,
    `Sign-in as ${EMAIL} did not reach the console. Is the API running and the anchor tenant seeded (pnpm db:seed)?`,
  ).toHaveURL(/\/app/, { timeout: 15_000 });
}

// The customer-facing shell. The seeded customer login is bound to a real
// `customers` row (seed/anchor.ts), so the cart has a company to book against
// and /account/applications has something to list.
export async function signInAsCustomer(page: Page): Promise<void> {
  await submit(page, CUSTOMER_EMAIL);
  await expect(
    page,
    `Sign-in as ${CUSTOMER_EMAIL} did not reach the account area. Is the API running and the anchor tenant seeded (pnpm db:seed)?`,
  ).toHaveURL(/\/account/, { timeout: 15_000 });
}

// The cross-tenant ArkiLaunch account (seed-identities.ts). Its home is the
// company applications queue on the platform host, not a tenant dashboard.
export async function signInAsPlatformAdmin(page: Page): Promise<void> {
  await submit(page, PLATFORM_EMAIL, platformUrl('/login'));
  await expect(
    page,
    `Sign-in as ${PLATFORM_EMAIL} did not reach the platform console. Is the API running and the platform tenant seeded (pnpm db:seed)?`,
  ).toHaveURL(/\/admin\/applications/, { timeout: 15_000 });
}
