import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// getUserMedia does not exist outside a secure context. `localhost` counts,
// so the viewfinder works on a laptop with no setup at all; a LAN address
// like http://192.168.1.5:5173 does not, and a phone loading it silently
// gets the file-input fallback instead -- which looks exactly like the
// feature working. Certificates are opt-in and gitignored: generate them
// with `pnpm dev:cert` and this serves https; with no certs present it
// serves plain http exactly as before.
const certDir = fileURLToPath(new URL('./certs/', import.meta.url));
const key = `${certDir}dev-key.pem`;
const cert = `${certDir}dev-cert.pem`;
const https =
  existsSync(key) && existsSync(cert)
    ? { key: readFileSync(key), cert: readFileSync(cert) }
    : undefined;

// Code-based TanStack Router (createRootRoute/createRoute) rather than the
// file-based plugin: fewer moving parts for this minimal shell, no
// generated routeTree.gen.ts to keep in sync.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true binds 0.0.0.0 so a phone on the same network can load the dev
  // server. The OCR capture path can only really be exercised from a phone
  // camera, and Vite answering on localhost only made that impossible.
  //
  // The /api proxy is what makes one VITE_API_BASE_URL work everywhere.
  // Pointing it at an absolute http://localhost:3000 meant a phone asked
  // its OWN localhost for the API; pointing it at the LAN address instead
  // would be blocked as mixed content the moment this server is https.
  // Proxied, the page calls a same-origin relative /api/v1 in every case
  // and Vite reaches the API server-side, which also keeps it out of the
  // API's CORS allowlist entirely.
  server: {
    host: true,
    port: 5173,
    ...(https ? { https } : {}),
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
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
