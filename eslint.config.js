import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * `docs/ADR-0002-architecture-and-performance.md` decision 7, made mechanical.
 *
 * Nothing here formats: every stylistic rule is left to Prettier, and none of
 * the presets below enable one, so the two tools have no overlap to fight over
 * and no `eslint-config-prettier` is needed to separate them.
 */

/** A module longer than this is two modules that have not been split. */
const MAX_MODULE_LINES = 300;

/** A function longer than this is hiding a name for part of itself. */
const MAX_FUNCTION_LINES = 50;

/** Branching past this is a decision table pretending to be control flow. */
const MAX_COMPLEXITY = 10;

const sharedRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'ExportDefaultDeclaration',
      message:
        'Export a named binding. A default export is renamed at every import site, which breaks ' +
        'the rule that the code uses the vocabulary of src/contracts/.',
    },
  ],
  complexity: ['error', { max: MAX_COMPLEXITY }],
  'max-lines': ['error', { max: MAX_MODULE_LINES, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'error',
    { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true },
  ],
  eqeqeq: ['error', 'always'],
  'no-console': 'error',
};

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  {
    // The product code: type-aware linting, one project per ring group.
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.inner.json', './tsconfig.ui.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // Build and tool configuration: plain JavaScript, run by Node, not linted
    // with type information because it belongs to no TypeScript project.
    files: ['*.js', 'scripts/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
    rules: sharedRules,
  },
  {
    // ESLint's own flat configuration is a module whose export is its default.
    files: ['eslint.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: sharedRules,
  },
);
