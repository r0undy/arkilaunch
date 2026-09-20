import { defineConfig } from '@playwright/test';

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
});
