const js = require('@eslint/js');
const globals = require('globals');
const typescriptParser = require('@typescript-eslint/parser');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const prettierPlugin = require('eslint-plugin-prettier');

// Adapted from admin-new/packages/eslint-config. Domain-specific rules and
// test-framework globals are intentionally excluded from this standalone app.
module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'target/**',
      'crates/dsp-wasm/pkg/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.cjs', 'apps/web/tests/**/*.mjs'],
    languageOptions: { globals: globals.node },
    plugins: { prettier: prettierPlugin },
    rules: { 'prettier/prettier': 'error' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      import: importPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      prettier: prettierPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-debugger': 'error',
      'no-console': 'off',
      'no-underscore-dangle': ['error', { allow: ['_id', '_retry'] }],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
        },
      ],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'react/jsx-filename-extension': ['error', { extensions: ['.tsx'] }],
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'prettier/prettier': 'error',
    },
  },
];
