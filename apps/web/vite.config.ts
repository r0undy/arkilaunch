import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// getUserMedia needs a secure context: a phone on a LAN http address silently gets the file fallback.
// `pnpm dev:cert` makes the opt-in certs that switch this to https.
const certDir = fileURLToPath(new URL('./certs/', import.meta.url));
const key = `${certDir}dev-key.pem`;
const cert = `${certDir}dev-cert.pem`;
const https =
  existsSync(key) && existsSync(cert)
    ? { key: readFileSync(key), cert: readFileSync(cert) }
    : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lazily imported deps Vite discovers mid-session trigger a reload that cold CI runs see as a blank page.
  optimizeDeps: { include: ['pdf-lib', 'qrcode'] },
  // Proxy /api so a phone on the LAN never calls its own localhost, and https never hits mixed content.
  server: {
    host: true,
    port: 5173,
    // Vite rejects unknown Host headers once host: true; `{tenant}.localhost` picks a tenant in dev.
    allowedHosts: ['.localhost'],
    ...(https ? { https } : {}),
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 3000}` } },
  },
  test: {
    // Keep vitest out of e2e/ (Playwright specs).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    // Bare localhost is the platform host, which redirects every tenant route to `/`.
    environmentOptions: { jsdom: { url: 'http://almara.localhost:3000/' } },
    setupFiles: ['./src/test/setup.ts'],
  },
});
