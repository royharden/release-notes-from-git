import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const noNodeImports = { group: ['node:*'], message: 'Browser and shared-core code uses Web APIs only.' };
const noSharedAlias = {
  group: ['@shared', '@shared/*'],
  message: 'src/core and scripts import the shared core by relative path (Node type stripping ignores aliases).',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', { patterns: [noNodeImports] }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noNodeImports, noSharedAlias] }] },
  },
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
    rules: { 'no-restricted-imports': ['error', { patterns: [noNodeImports, noSharedAlias] }] },
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-imports': ['error', { patterns: [noSharedAlias] }] },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
