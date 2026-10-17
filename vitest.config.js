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
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1) and is held high.
 * `src/contracts/` is held to the same number since it acquired the page
 * decoders (decision 3 as amended, S08): the rest of the ring is type
 * declarations, which the v8 provider reports as 100 per cent of a zero
 * denominator, so the number is reached by the decoders and nothing else moves
 * it. `src/app/`, `src/preload/` and `src/ui/` are wiring, their guarantee comes
 * from the end-to-end gate, and holding them to a number would buy a test that
 * asserts the wiring is wired. They are reported and not thresholded on purpose.
 *
 * The numbers are a ratchet (`AGENTS.md` §11): they move up, and moving one down
 * is a commit that says why.
 *
 * ## The inner clock, and why this suite runs its files one at a time
 *
 * This suite is run two ways. `gates:unit` runs it once, alone. The mutation
 * gate runs it **once per mutant**, seven copies at a time, which is Stryker's
 * default concurrency on the eight-core development machine. Everything below is
 * about the second way, and E01-M01-S09 measured all of it here by running the
 * gate's own per-mutant command — `node node_modules/vitest/vitest.mjs run
 * --reporter=dot --fsModuleCache` — in seven concurrent copies, which is that
 * condition exactly.
 *
 * **`testTimeout` was never set, so every test ran under the framework's default
 * of 5 000 ms, which nobody chose, and it fired.** Each copy runs its files in
 * vitest's own pool of workers, which vitest 5.0.0 sizes in a run, unless told
 * otherwise, at `os.availableParallelism() - 1` (`resolveMaxWorkers` in
 * `node_modules/vitest/dist/chunks/index.*.js`): seven here. So seven copies,
 * each running its files seven at a time, were some 49 worker processes on
 * eight cores. Review round 15 counted that pool, and E01-M01-FIX-16 counted it
 * again at `e6e1a3e`, by sampling the process table every 100 ms through one
 * run of `node node_modules/vitest/vitest.mjs run --reporter=dot`: at most seven
 * children running `vitest/dist/workers/forks.js` with `--fileParallelism`, one
 * with `--no-fileParallelism`. The suite had 21 files when S09 measured what
 * follows and has 25 at `e6e1a3e`; the pool is seven either way. The
 * scheduler's tail is long: over three batches of seven
 * copies the slowest *healthy* test took 4.30 s, 4.06 s and 3.88 s against an
 * idle 0.40 s, and **two of those 21 runs failed outright** on a test crossing
 * 5 000 ms — 5.11 s and 6.26 s. A run that fails for that reason exits non-zero,
 * and Stryker records the mutant as killed by a clock that says nothing about the
 * mutant. That is the defect this configuration now fixes at its cause.
 *
 * **The cause is the nesting, so the fix is `fileParallelism: false`.** The
 * mutation gate already saturates the machine with seven whole suites; the suite
 * multiplying itself on top of that buys nothing and costs the tail. With the
 * files run one at a time, measured over **57 concurrent runs in eight batches,
 * 19 437 test observations and no failure at all**, the slowest healthy test was
 * **1.07 s** — a quarter of what it was — and the per-copy wall clock was
 * unchanged at 26 s, because the machine was the bottleneck either way. Under a
 * deliberately tripled load (eight spinning processes beside the seven copies) it
 * was **1.92 s** over a further 14 runs. What it costs is this suite run alone,
 * where seven workers do help: the gate's own command goes from 3.8–5.2 s to
 * 8.4–9.4 s, and `gates:unit:modules`, which adds coverage, from 6.3 s to
 * 11.3–14.0 s. That is about six seconds on a pipeline of an hour, paid so that
 * both ways of running this suite are the same run.
 *
 * **`testTimeout` is 15 000 ms**: 7.8 times the slowest healthy test measured
 * under that tripled load, 14 times the slowest measured without it, and about a
 * ninth of the outer budget `stryker.config.json` sets over the whole command, so
 * that an asynchronously hung test is caught here, by the clock that names the
 * test, rather than there, by the clock that names nothing. It is one value for
 * every run of this suite and not a mutation-only value: the mutation gate exists
 * to measure what `gates:unit` runs, and two configurations would mean the two
 * disagree about which test is hung. Alone, a generous inner clock costs one
 * timeout on a test that hangs and nothing on any other run.
 *
 * `hookTimeout` is set to the same value and defaulted to 10 000 ms before.
 * This suite has no `beforeAll`, `beforeEach` or `afterAll` today — grepped, not
 * assumed — so the number is chosen in advance of the hook that will want it
 * rather than left to be discovered by a hook crossing it.
 *
 * `vitest.fixtures.config.js` and `vitest.perf.config.js` already set their own
 * timeouts explicitly, so this was the last run in the project still on a clock
 * nobody picked.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
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
        'src/contracts/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
