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
    // Nothing generated is linted. `eslint .` walks the working tree, so a
    // directory that exists only because a gate ran is a directory this gate
    // reads — and a `files` pattern here is not anchored, so `src/**/*.ts`
    // matches a copy of `src/` at any depth. Stryker copies the whole project
    // into `.stryker-tmp/sandbox-<id>/` and prepends `// @ts-nocheck` to every
    // `src/` and `test/` file it puts there, which is its `disableTypeChecks`
    // default and which `@typescript-eslint/ban-ts-comment` forbids. Measured in
    // this lane, with the three entries this list used to hold and one sandbox on
    // disk: `eslint .` reported **1674 errors, every one of them inside
    // `.stryker-tmp/`**. That is S03's report — a lint run that had been green
    // coming back red because a mutation run was in flight in another shell —
    // reproduced. It cannot happen inside `npm run gates`, where lint is gate 2
    // and mutation is gate 7; it happens to whoever runs the two at once, which
    // at 62 minutes for the mutation gate is what people do. Every entry below
    // is a `.gitignore` entry as well, and with them `eslint .` reads 91 files,
    // which is exactly the tracked files its patterns cover, so none of them can
    // hide a committed file.
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '.stryker-tmp/',
      'reports/',
      'playwright-report/',
      'test-results/',
      'test/fixtures/repositories/',
    ],
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
    // The test and measurement harnesses: TypeScript, outside every ring,
    // belonging to no bundle and run by their own runners. They are held to the
    // same type-aware rules as the product code, with nothing relaxed; where
    // they have to report a number they write to the stream rather than reach
    // for the `console` the rules forbid.
    files: ['test/**/*.ts', 'perf/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // A tool's flat configuration is a module whose export is its default: the
    // tool reads it by importing the file, so there is no import site for a
    // named binding to be renamed at, and the rule above has nothing to protect.
    files: [
      'eslint.config.js',
      'vitest.config.js',
      'vitest.fixtures.config.js',
      'vitest.perf.config.js',
      'playwright.config.js',
      'commitlint.config.js',
    ],
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
