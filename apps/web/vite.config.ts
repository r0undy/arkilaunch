import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Code-based TanStack Router (createRootRoute/createRoute) rather than the
// file-based plugin: fewer moving parts for this minimal shell, no
// generated routeTree.gen.ts to keep in sync.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
});
