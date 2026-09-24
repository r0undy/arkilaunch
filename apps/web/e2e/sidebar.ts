import { expect, type Locator, type Page } from '@playwright/test';

// Below lg the sidebar is an off-canvas drawer, so a spec that just looks for
// a nav link finds nothing on a phone -- which is how the mobile project
// earned its keep the first time it ran.
//
// Opening the drawer also means the links exist TWICE: the hidden desktop
// <aside> is still in the DOM beside the drawer's copy, and Playwright's
// strict mode counts both. Every query here is filtered to the visible one.
export function sidebarLink(page: Page, name: string): Locator {
  return page.getByRole('link', { name, exact: true }).filter({ visible: true });
}

/**
 * Make the sidebar's links reachable, at either viewport.
 *
 * The first version asked `isVisible()` the instant the call was made, which
 * is a snapshot rather than a wait: on a slow CI boot the app bar had not
 * rendered yet, the answer was "no menu button", the drawer was never opened
 * and the spec failed looking for links that were display:none. It passed on
 * a warm run and failed on a cold one -- a flake, not a bug in the app.
 */
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
