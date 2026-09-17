import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Code-based TanStack Router (createRootRoute/createRoute) rather than the
// file-based plugin: fewer moving parts for this minimal shell, no
// generated routeTree.gen.ts to keep in sync.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true binds 0.0.0.0 so a phone on the same network can load the dev
  // server. The OCR capture path can only really be exercised from a phone
  // camera, and apps/web/.env already points VITE_API_BASE_URL at the LAN
  // address, which is useless while Vite itself answers on localhost only.
  server: { host: true, port: 5173 },
  test: {
    // Scope vitest to src/ only; e2e/ holds Playwright specs (run via `pnpm e2e`),
    // which vitest's default glob would otherwise pick up and crash on.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Existing component tests use renderToStaticMarkup and never touch
    // `document`, so they pass unchanged under jsdom; new tests (guards,
    // auth-client, route-level) need a real DOM to render into.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
