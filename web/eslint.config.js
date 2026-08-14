import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/', 'dist-desktop/', 'dist-mobile/', 'dist-export/', 'node_modules/'],
  },
  js.configs.recommended,
  ...svelte.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'svelte/no-useless-mustaches': ['error', { ignoreStringEscape: true }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.test.{js,ts,tsx}', 'vitest.setup.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
  {
    files: ['*.config.js', 'vite.config.*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
