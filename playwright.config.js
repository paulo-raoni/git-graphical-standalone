import { defineConfig } from '@playwright/test';

/**
 * The end-to-end gate: `AGENTS.md` §7's "open the actual thing", made
 * repeatable.
 *
 * It drives the **built** application, which is why nothing here starts a
 * server and why `gates:build` runs before it in `npm run gates`. There is one
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
});
