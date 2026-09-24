import { defineConfig, devices } from '@playwright/test';

// The dev server serves HTTPS with a self-signed LAN certificate (getUserMedia
// needs a secure context for DTR capture, 434906a), so the old
// http://localhost:5173 baseURL could only ever answer ERR_EMPTY_RESPONSE.
// PLAYWRIGHT_BASE_URL overrides it when vite has fallen through to another
// port because 5173 was taken.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
  },
  // The certificate is self-signed by scripts/dev-cert.mjs; a browser that
  // refuses it cannot test the app at all.
  use: { baseURL, ignoreHTTPSErrors: true },
  // The suite ran at one desktop size and nothing else, so the sidebar's
  // lg: drawer switch, the catalog's right rail and the storefront header
  // had never been exercised at phone width -- the 360px floor DESIGN.md
  // §4.1 mandates was asserted nowhere.
  //
  // Mobile is scoped by testMatch rather than run across the whole suite:
  // the admin-console specs are desktop workflows where a Pixel 5 pass costs
  // CI minutes and yields no signal. Two specs, not seven.
  projects: [
    {
      name: 'desktop',
      // An explicit 1440 rather than Desktop Chrome's 1280: the catalog's
      // right rail appears at xl, which IS 1280, so the default viewport sat
      // exactly on the breakpoint and the rail assertions were one rounding
      // decision away from flaking.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL,
        ignoreHTTPSErrors: true,
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], baseURL, ignoreHTTPSErrors: true },
      testMatch: /(storefront-ui|cart|equipment-browse)\.spec\.ts/,
    },
  ],
});
