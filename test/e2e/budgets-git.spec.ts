import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { described, holdToBaseline, paintedState, withBudgeted } from './support/budgets';
import { loadMoreAndShow, pressRefresh, setMarking } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * What a request costs in git processes, and how the cost of a Load More grows
 * with the pages already loaded — two counters of
 * `docs/ADR-0003-quality-gates-and-ci.md` decision 4 and E01-M01-S06's item 3.
 *
 * **The git processes are counted by git.** `GIT_TRACE2_EVENT`, set to a file in
 * the application's environment, makes every git process append a `start`
 * event to that file as it begins; the application passes its environment on to
 * git unchanged apart from the seven variables that redirect a repository
 * (`src/adapters/git-process.ts`), and the utility process inherits the main
 * process's. So nothing in the product is touched, and a process git itself
 * starts — a hook, a helper — is counted too, as the cost it is.
 *
 * **The growth of a Load More is counted by the page it answers.** The utility
 * process reads the whole page again at every press (S06, *How a further page
 * is read*), so the *n*th press parses and stores *n + 1* pages of commits; the
 * reply's `commits.count` is how many it stored. The fifth press over the first
 * is therefore a ratio no machine can move, and it is 3 while the reader cannot
 * start at an offset. A reader that could would bring it to 1, which this gate
 * would report as an improvement to commit. The wall clock of each press is
 * printed beside it, and is not what is held.
 *
 * **This case is run by `gates:e2e`**, and not by `npm run gates:budgets`,
 * though it shares a name with the suites that are: everything it holds is a
 * count, so it does not carry the `@budgets` tag that
 * `playwright.config.js` selects by (`AGENTS.md` §11, *Gate tiers*).
 */

/**
 * The git command an argument list runs: the first word that is neither an
 * option nor an option's value, or the options themselves when there is none,
 * which is how discovery's `git --version` reads.
 */
function commandOf(argv: readonly string[]): string {
  for (let at = 1; at < argv.length; at += 1) {
    const word = argv[at] ?? '';
    if (word === '-C' || word === '-c') {
      at += 1;
    } else if (!word.startsWith('-')) {
      return word;
    }
  }
  return argv.slice(1).join(' ');
}

/** Every `start` event git wrote to `file`: one per git process, with what it was asked to do. */
function gitStarts(file: string): string[] {
  const commands: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.includes('"event":"start"')) {
      commands.push(commandOf((JSON.parse(line) as { argv?: string[] }).argv ?? []));
    }
  }
  return commands;
}

/** The environment the application is launched with: this one, plus the trace. */
function tracedEnvironment(file: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  environment['GIT_TRACE2_EVENT'] = file;
  return environment;
}

/** What the requests cost, read off the trace and the replies. */
interface RequestCosts {
  readonly opened: readonly string[];
  readonly refreshed: readonly string[];
  readonly perPress: readonly number[];
  readonly stored: readonly number[];
  readonly times: readonly number[];
}

/** Open, press Load More five times over the bridge, press Refresh, and count. */
async function measureRequests(
  page: Page,
  repository: string,
  trace: string,
): Promise<RequestCosts> {
  await paintedState(page, (state) => state.path === repository && state.rows === 300);
  const opened = gitStarts(trace);
  const perPress: number[] = [];
  const stored: number[] = [];
  const times: number[] = [];
  for (let press = 0; press < 5; press += 1) {
    const before = gitStarts(trace).length;
    const loaded = await page.evaluate(loadMoreAndShow, 300);
    perPress.push(gitStarts(trace).length - before);
    stored.push(loaded.commits);
    times.push(loaded.milliseconds);
  }
  const beforeRefresh = gitStarts(trace).length;
  await page.evaluate(setMarking, true);
  const pressed = await page.evaluate(pressRefresh);
  await paintedState(
    page,
    (state) => state.refresh === 'Refresh' && !state.refreshDisabled,
    pressed,
  );
  return { opened, refreshed: gitStarts(trace).slice(beforeRefresh), perPress, stored, times };
}

test('git processes per request, and what a Load More reads as pages accumulate', async () => {
  test.setTimeout(300_000);
  const repository = fixture('large', 'large', 10_000);
  const directory = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-trace-'));
  const trace = join(directory, 'trace2.json');
  writeFileSync(trace, '');
  try {
    await withBudgeted({ open: repository, env: tracedEnvironment(trace) }, async ({ page }) => {
      const costs = await measureRequests(page, repository, trace);
      process.stdout.write(
        `  open: ${String(costs.opened.length)} git processes (${costs.opened.join(', ')}); ` +
          `refresh: ${String(costs.refreshed.length)} (${costs.refreshed.join(', ')})\n` +
          `  five Load Mores: ${costs.perPress.join(', ')} git processes; ` +
          `commits stored ${costs.stored.join(', ')}; ${described(costs.times)} ms\n`,
      );
      const growth = (costs.stored[4] ?? 0) / (costs.stored[0] ?? 1);
      const verdicts = [
        holdToBaseline(
          'gitProcessesPerOpen',
          'git processes to open a repository',
          costs.opened.length,
        ).failed,
        holdToBaseline(
          'gitProcessesPerRefresh',
          'git processes per Refresh',
          costs.refreshed.length,
        ).failed,
        holdToBaseline(
          'gitProcessesPerLoadMore',
          'git processes per Load More, worst of five',
          Math.max(...costs.perPress),
        ).failed,
        holdToBaseline(
          'loadMoreReadGrowth',
          'commits read by the fifth Load More over the first',
          growth,
        ).failed,
      ];
      expect(verdicts).toEqual([false, false, false, false]);
      expect(costs.stored).toEqual([600, 900, 1200, 1500, 1800]);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
