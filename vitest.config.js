import { defineConfig } from 'vitest/config';

/**
 * The unit gate, over the colocated module tests.
 *
 * Unit tests are colocated with the module they test, as `<name>.test.ts`, so
 * that a lane owns a folder including its tests and never edits another lane's
 * files.
 *
 * This configuration deliberately covers `src/` **only**. The mutation gate runs
 * this suite once per mutant, so anything slow in it is multiplied by the
 * hundreds; the fixture generator's proof spawns git some seventy times and has
 * its own configuration and its own step of `gates:unit` for exactly that
 * reason.
 *
 * Coverage thresholds are **per directory**, which is the whole point of the
 * gate. `src/core/` holds every decision that can be wrong
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1) and is held high;
 * `src/app/`, `src/preload/` and `src/ui/` are wiring, their guarantee comes
 * from the end-to-end gate, and holding them to a number would buy a test that
 * asserts the wiring is wired. They are reported and not thresholded on purpose.
 *
 * The numbers are a ratchet (`AGENTS.md` §11): they move up, and moving one down
 * is a commit that says why.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        'src/core/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
