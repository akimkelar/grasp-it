import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '.grasp-it/**',
      'coverage/**',
      '**/*.tsbuildinfo',
      'docs/**',
      'grasp-it-plugin/agents/**',
      'grasp-it-plugin/skills/**',
      '.claude/**',
      '.idea/**',
      '.worktrees/**',
      'install/**',
    ],
  },

  // Base JS recommended rules for all files
  js.configs.recommended,

  // TypeScript recommended ruleset
  ...tseslint.configs.recommended,

  // TypeScript files - apply language options and relax noisy rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The codebase has many unused imports/values left from iteration.
      // Allow underscore-prefixed placeholders; disable for vars/imports.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Intentional empty marker interfaces used as future-extensibility
      // placeholders in the MCP server types module.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // JS/MJS files (skill scripts, test helpers)
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },

  // Test files - relax additional rules common in tests
  {
    files: ['**/*.test.ts', '**/*.test.mjs', 'tests/**', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // Tests embed shell script in JS template literals; backslash escapes
      // for bash double-quotes are intentional and required for correct
      // shell behavior.
      'no-useless-escape': 'off',
    },
  },
];