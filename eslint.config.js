// Flat ESLint config (ESLint 10). Dev-only — not part of the runtime or the
// .mcpb bundle. Lints the pure-JS ESM sources + tests for Node 24.

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'research/', 'plans/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'], // allow `== null`, forbid other loose equality
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
];
