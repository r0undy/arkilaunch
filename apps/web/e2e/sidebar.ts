import { expect, type Locator, type Page } from '@playwright/test';

// Below lg the sidebar is a drawer and the hidden desktop <aside> stays in the DOM (strict mode counts both),
// so every query is filtered to the visible copy.
export function sidebarLink(page: Page, name: string): Locator {
  return page
    .locator('aside[aria-label="Sidebar"], [role="dialog"]')
    .getByRole('link', { name, exact: true })
    .filter({ visible: true });
}

// Waits instead of snapshotting isVisible(): on a cold CI boot the app bar has not rendered yet.
export async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  const onPhone = await menu
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    // No hamburger is the desktop case, where the sidebar is always on screen.
    .catch(() => false);
  if (!onPhone) return;

  // Already open (a previous call in the same test), so leave it alone --
  // clicking would toggle it shut.
  if (await sidebarLink(page, 'Home').isVisible()) return;

  await menu.click();
  // Wait for the drawer rather than returning into a race with its render.
  await expect(sidebarLink(page, 'Home')).toBeVisible();
}
