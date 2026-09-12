import { defineConfig } from 'vitest/config';

/**
 * The second half of the unit gate: everything that spawns git.
 *
 * It is a separate configuration because it is a separate cost. Building the
 * eight fixture repositories spawns git about seventy times, which on Windows is
 * half a minute of process creation, and the mutation gate runs the *other*
 * suite once per mutant. Mixing the two would multiply that half minute by
 * several hundred.
 *
 * Two suites live here, and they are named apart by their extension rather than
 * by their directory. `test/**` is the fixture generator's determinism, which
 * proves a property of generated data. `src/adapters/**` is the git adapter's
 * own suite, which has to live beside the module it tests — a lane owns a folder
 * including its tests — and must **not** be collected by `vitest.config.js`,
 * whose `src/**\/*.test.ts` the mutation gate runs hundreds of times. So the
 * adapter's tests are `.spec.ts`: the same name Playwright's end-to-end suite
 * uses, for the same reason, and one that `src/**\/*.test.ts` does not match.
 *
 * No coverage is collected here. What these prove is agreement with a real git,
 * which a line counter cannot see.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/adapters/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
