import { defineConfig } from '@playwright/test';

/**
 * The two end-to-end gates: `AGENTS.md` §7's "open the actual thing", made
 * repeatable, and the wall-clock budgets beside it (`AGENTS.md` §11, *Gate
 * tiers*).
 *
 * Both drive the **built** application, which is why nothing here starts a
 * server, why `gates:build` runs before `gates:e2e` in `npm run gates` and
 * `npm run gates:quick`, and why `gates:budgets` builds for itself. There is one
 * worker and no parallelism: every test starts a real Electron process, and two
 * of them racing for the same `dist/` and the same window tells you nothing.
 *
 * `forbidOnly` is on, so a focused test cannot silently skip its neighbours in a
 * run that still reports success — the same failure `gates:placeholders` catches
 * in the tree, caught again by the runner that would otherwise be fooled.
 *
 * Retries are zero on purpose. A flaky end-to-end test is a defect of the test
 * (`docs/ADR-0003-quality-gates-and-ci.md`, consequences), and a retry is how a
 * flaky one stops being noticed.
 */

/**
 * The tag a case carries in its title when its verdict depends on the clock or
 * on the machine's load: a time, a frame cost, a processor percentage, a memory
 * reading that waits for a settle. `npm run gates:budgets` runs the tagged
 * cases and no other case of this folder, beside the timed benchmarks of
 * `perf/`, on a free machine (`AGENTS.md` §11, *Wall-clock gates on a shared
 * machine*); `npm run gates:e2e` runs every untagged case.
 *
 * **This pattern is the one thing the partition hinges on, and it is used twice
 * below**: as the `grep` of the `budgets` project and as the `grepInvert` of
 * the `application` project. A case it matches is in the first and not in the
 * second, and a case it does not match is in the second and not in the first,
 * so whatever a case is called it is in exactly one of the two.
 *
 * The rule for an author: a case held to a time or to the machine's load ends
 * its title with the tag; a case that holds a count or a byte comparison has
 * none. The tag travels with the case through a rename of the case or of its
 * file. What nothing checks is the judgement itself: a new wall-clock case
 * written without the tag runs in `gates:e2e`, still run, on a machine nobody
 * checked was free, and a tag misspelt does the same.
 */
const BUDGETS = /@budgets\b/;

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  projects: [
    { name: 'application', grepInvert: BUDGETS },
    { name: 'budgets', grep: BUDGETS },
  ],
});
