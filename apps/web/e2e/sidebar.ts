import type { Locator, Page } from '@playwright/test';

// Below lg the sidebar is an off-canvas drawer, so a spec that just looks for
// a nav link finds nothing on a phone -- which is how the mobile project
// earned its keep the first time it ran.
//
// Opening the drawer also means the links exist TWICE: the hidden desktop
// <aside> is still in the DOM beside the drawer's copy, and Playwright's
// strict mode counts both. Every query here is filtered to the visible one.
export async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  if (await menu.isVisible()) await menu.click();
}

export function sidebarLink(page: Page, name: string): Locator {
  return page.getByRole('link', { name, exact: true }).filter({ visible: true });
}
