import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.turbo/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Test doubles must never bind in a shipping code path. A fixture
    // returns plausible-looking values, so one that binds by accident is
    // indistinguishable from a real reading at the call site -- which is
    // exactly what happened before cr-arkilaunch-pilot-honesty.md, where
    // apps/api/src/kyc/kyc.module.ts bound a fixture returning a literal
    // SEC number in every environment. `pnpm lint` runs in CI, so this is
    // the enforcement.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@arkilaunch/shared/testing',
              message:
                'Test doubles are spec-only. Production code must resolve an adapter through createDocumentIntelligenceAdapter() / createWeatherAdapter(), which fail closed when no real adapter is available.',
            },
          ],
        },
      ],
    },
  },
  {
    // Spec files are the one legitimate consumer.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx', 'apps/api/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Node build scripts (not bundled by Vite, no browser globals available).
    // `fetch` is Node 24's built-in global (package.json engines pins >=24).
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' },
    },
  },
);
