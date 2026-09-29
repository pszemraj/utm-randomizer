import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Every function, class, method, interface, type alias, and exported constant needs a doc comment.
// Parameters and return values are typed by TypeScript, so @param/@returns tags are optional,
// but any tags that are written must be valid and match the signature.
const jsdocRules = {
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: false,
      checkConstructors: false,
      require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
      contexts: [
        'TSInterfaceDeclaration',
        'TSTypeAliasDeclaration',
        'ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
      ],
    },
  ],
  'jsdoc/require-param': 'off',
  'jsdoc/require-returns': 'off',
  // One blank line between the description and the first tag.
  'jsdoc/tag-lines': ['error', 'never', { startLines: 1 }],
};

export default defineConfig(
  { ignores: ['dist/', 'release/', 'coverage/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `text || fallback` on strings is usually meant to catch '' too.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.ts', '*.config.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    extends: [jsdoc.configs['flat/recommended-typescript-error']],
    rules: jsdocRules,
  },
  {
    // Plain JavaScript: types live in JSDoc, TypeScript-style.
    files: ['scripts/**/*.mjs'],
    extends: [jsdoc.configs['flat/recommended-typescript-flavor-error']],
    rules: jsdocRules,
  },
);
