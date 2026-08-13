import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * Flat config covering every JS/TS package in the repo.
 * Apps deliberately keep their own package.json (ADR-019) but share one
 * lint contract so conventions cannot drift between backend, web and mobile.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'datasets/**',
      'ml-service/**', // Python — linted by ruff when that service lands
    ],
  },

  js.configs.recommended,

  // ── Backend: Node, JavaScript ESM (ADR-019) ──────────────────────────────
  {
    files: ['backend/**/*.js', 'backend/**/*.mjs', 'scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': ['warn', { allow: ['error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Standalone tooling scripts print to stdout by design.
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'backend/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },

  // ── Web: React + TypeScript ──────────────────────────────────────────────
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['web/**/*.{ts,tsx}'],
  })),
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/**/vite.config.ts', 'web/**/vitest.config.ts', 'web/**/playwright.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  /**
   * Playwright specs are Node test code, not React.
   *
   * The hooks rule in particular produces a false positive here: Playwright's
   * fixture API takes a callback named `use`, and `rules-of-hooks` reads any
   * `use(...)` call as React's `use` hook being called outside a component.
   * There are no components in this directory to apply the rule to.
   */
  {
    files: ['web/**/e2e/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },

  prettier,
];
