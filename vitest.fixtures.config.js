import { defineConfig } from 'vitest/config';

/**
 * The second half of the unit gate: every check that must not run once per
 * mutant, most of them because they spawn git or another program.
 *
 * It is a separate configuration because it is a separate cost. Building the
 * eight fixture repositories spawns git about seventy times, which on Windows is
 * half a minute of process creation, and the mutation gate runs the *other*
 * suite once per mutant. Mixing the two would multiply that half minute by
 * several hundred.
 *
 * It collects two patterns, and what each holds is named by the pattern rather
 * than counted, because the next check added to either would make a count false.
 * `test/**\/*.test.ts` is every check that lives outside `src/`: what the fixture
 * repositories and their stores guarantee, what the end-to-end projects collect,
 * and what the gates under `scripts/gates/` read, each file's header saying which.
 * `src/adapters/**\/*.spec.ts` is the git adapter's own suite, which has to live
 * beside the module it tests — a lane owns a folder including its tests — and
 * must **not** be collected by `vitest.config.js`, whose `src/**\/*.test.ts` the
 * mutation gate runs hundreds of times. So the adapter's tests are `.spec.ts`:
 * the same name Playwright's end-to-end suite uses, for the same reason, and one
 * that `src/**\/*.test.ts` does not match.
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
