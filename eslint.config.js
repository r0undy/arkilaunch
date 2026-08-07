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
    // Node build scripts (not bundled by Vite, no browser globals available).
    // `fetch` is Node 24's built-in global (package.json engines pins >=24).
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' },
    },
  },
);
