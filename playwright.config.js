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
 * The cases whose verdict depends on the clock or on the machine's load: a
 * time, a frame cost, a processor percentage, a memory reading that waits for a
 * settle. `npm run gates:budgets` runs these and nothing else, on a free
 * machine (`AGENTS.md` §11, *Wall-clock gates on a shared machine*);
 * `npm run gates:e2e` runs every other case.
 *
 * Each pattern is matched against a case's file name, a space, and its title,
 * which is the text Playwright filters a project by. A whole file is named
 * where every case in it is held to a clock; a single title where its
 * neighbours in the file are counts, which no load moves.
 *
 * **This list is the one thing the partition hinges on, and it is used twice
 * below**: as the `grep` of the `budgets` project and as the `grepInvert` of the
 * `application` project. A case the list matches is in the first and not in the
 * second, and a case it does not match is in the second and not in the first,
 * so whatever a case is called it is in exactly one of the two. What the list
 * cannot do is follow a rename: a budget case whose title or file changes
 * stops matching and runs in `gates:e2e` from then on, still run, on a machine
 * nobody checked was free. A pattern that matches nothing leaves the `budgets`
 * project with fewer cases than it had, and with none at all Playwright fails
 * the run as having found no tests.
 */
const BUDGETS = [
  /budgets-start\.spec\.ts /,
  /budgets-memory\.spec\.ts /,
  /budgets-frames\.spec\.ts main-thread work per frame while scrolling$/,
  /open-repository\.spec\.ts the main process keeps answering while the whole of a large load runs$/,
];

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
