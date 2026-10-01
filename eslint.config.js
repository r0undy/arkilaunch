import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.wrangler/**', '**/worker-configuration.d.ts', 'apps/web/public/vendor/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Test doubles must never bind in shipping code: a fixture's plausible values look real.
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
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx', 'apps/api/test/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Node build scripts: Node 24 globals, no browser.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' },
    },
  },
);
