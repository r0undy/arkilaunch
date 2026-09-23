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
const PASSWORD = process.env.SEED_PASSWORD ?? 'admin';

async function submit(page: Page, email: string) {
  await page.goto('/login');
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
// `customers` row (seed/anchor.ts), so /account/applications has something
// to list rather than rendering its empty state.
export async function signInAsCustomer(page: Page): Promise<void> {
  await submit(page, CUSTOMER_EMAIL);
  await expect(
    page,
    `Sign-in as ${CUSTOMER_EMAIL} did not reach the account area. Is the API running and the anchor tenant seeded (pnpm db:seed)?`,
  ).toHaveURL(/\/account/, { timeout: 15_000 });
}
