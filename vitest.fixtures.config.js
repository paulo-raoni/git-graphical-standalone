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
 * It collects two patterns, and what each holds is named by the pattern and the
 * folder rather than counted, because the next check added to either would make
 * a count false.
 *
 * `test/**\/*.test.ts` is every `*.test.ts` under `test/`. That is not every
 * check outside `src/`: `perf/**\/*.perf.test.ts` belongs to
 * `vitest.perf.config.js`, and `test/e2e/**\/*.spec.ts` to Playwright. Under
 * `test/` it holds three kinds of check, each file's header saying which it is
 * and what it holds:
 *
 * - `test/fixtures/`: what the generator of the fixture repositories and the two
 *   stores that share them guarantee, read with a real git the checks spawn.
 * - `test/e2e-partition.test.ts`: which end-to-end cases each Playwright project
 *   collects, read from a Playwright the check spawns to list them.
 * - `test/gates/`: what the gate scripts under `scripts/gates/` decide. These
 *   are not agreement with a real git. The mutation gate's checks and the
 *   licences gate's check replay committed reports, recorded runs or entries they
 *   name through the gate's own functions and spawn nothing; the commits gate's
 *   check spawns git only to build a repository of its own, in which it reads the
 *   range the gate chooses.
 *
 * `src/adapters/**\/*.spec.ts` is the git adapter's own suite. It has to live
 * beside the module it tests — a lane owns a folder including its tests — and
 * must **not** be collected by `vitest.config.js`, whose `src/**\/*.test.ts` the
 * mutation gate runs hundreds of times. So the adapter's tests are `.spec.ts`:
 * the same name Playwright's end-to-end suite uses, for the same reason, and one
 * that `src/**\/*.test.ts` does not match.
 *
 * No coverage is collected here. Most of what the fixture, partition and adapter
 * checks prove is agreement with a program they run, which a line counter cannot
 * see. What the gate checks hold are scripts under `scripts/gates/`, and the
 * coverage gate of `vitest.config.js` counts files under `src/` only.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/adapters/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
