import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { FailureKind } from '../../src/contracts/index';
import type { GitGraphicalBridge, GraphPage } from '../../src/contracts/index';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture } from './support/fixtures';

/**
 * A reply is applied only to the repository it was read for.
 *
 * The utility process answers an Open, a Refresh and a Load More as they arrive
 * and each awaits a read of git, so their reads can finish in any order. Review
 * round 15 of E01-M01 drove one such order through the built application: a
 * Refresh of the ten-thousand-commit fixture, overtaken by an Open of a
 * three-commit one, drew the large graph under the small repository's path and
 * then failed the next Load More as if git had (finding F-31). This suite drives
 * the same sequence and requires the window to show the repository it names.
 *
 * **The ordering is a race, so it is required rather than assumed, and retried
 * rather than hoped for.** Every attempt checks the end state whichever request
 * answered first, because both orders must end on the repository opened last;
 * an attempt in which the stale request answered first is repeated, up to
 * {@link ATTEMPTS} times, and a case in which the ordering never occurred fails.
 * So a machine on which the stale request always wins reports red, not a pass
 * that tested nothing.
 *
 * **Its own file, with its own copy of two helpers.** It was meant to sit in
 * `test/e2e/open-repository.spec.ts`, which was at the line limit the lint gate
 * holds every module to when this suite was written. So the table's row count
 * and `withWindow` are repeated here. The repositories come from `test/e2e/support/fixtures.ts`, which the
 * suites that open repositories share, and which says when a shared repository
 * counts as built; this suite writes into none of them.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for the ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

/**
 * How many times a race is run before a case gives up on seeing its ordering.
 * Counted by FIX-14's second session on 2026-09-26, at {@link GROWN_ROWS} rows and
 * with nothing planted to slow either side: the stale request answered first in
 * one bridge race of 52 and in none of 28 window races.
 */
const ATTEMPTS = 4;

/**
 * The whole fixture, so that a refresh reads ten thousand commits beside an open
 * that reads three. Round 15 grew it to 6 300; at that size FIX-14's first
 * session saw the window case fail two runs of nine with the fix in place, the
 * one whose output it kept because the refresh answered first.
 */
const GROWN_ROWS = 10_000;

const ROW = '.row';
const MORE = '.graph__more';
const FAILURE_HEADLINE = '.failure__headline';

/* --- What runs inside the page. `tsconfig.node.json` has no DOM library, so
   every element this touches is described here rather than borrowed. --- */

interface ObservedControl {
  readonly textContent: string | null;
  readonly clientHeight: number;
  click(): void;
}

interface PageScope {
  readonly document: { readonly querySelector: (selector: string) => ObservedControl | null };
  readonly gitGraphical: GitGraphicalBridge;
  readonly gitGraphicalView?: { readonly showPage: (page: GraphPage) => void };
  readonly MutationObserver: new (callback: () => void) => {
    readonly observe: (
      target: ObservedControl,
      options: { childList: boolean; characterData: boolean; subtree: boolean },
    ) => void;
  };
  readonly performance: { readonly now: () => number };
  settledControls?: Settled[];
}

/** How many rows the table's spacer is sized for, which is the page's own row count. */
function tableRows(rowHeight: number): number {
  const spacer = (globalThis as unknown as PageScope).document.querySelector('.graph__spacer');
  return spacer === null ? -1 : Math.round(spacer.clientHeight / rowHeight);
}

/** Grow the open repository to `rows` rows over the bridge, and draw the page. */
async function growAndDraw(input: { rows: number; from: number }): Promise<number> {
  const scope = globalThis as unknown as PageScope;
  const reply = await scope.gitGraphical.loadMoreCommits({ count: input.rows - input.from });
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  scope.gitGraphicalView?.showPage(reply.value);
  return reply.value.layout.rowCount;
}

/** One control of the bar, and what it says while the request it started runs. */
type WatchedControl = { name: string; selector: string; busy: string };

/** A control whose request has been answered, and how long after the clicks. */
type Settled = { name: string; ms: number };

/**
 * Click the bar's controls in the order given, in one turn of the page, and
 * record the order in which they finish the requests they started.
 *
 * Read off the **label**, because in `src/ui/renderer.ts` a bar control's label
 * is written only by `whileBusy`: set to its busy text on the click, and put
 * back only in `finally`, which runs when that control's own reply has arrived.
 * The host posts its replies in the order it decided them, so this order is the
 * host's. `disabled` has a second writer, `receive`, which on every successful
 * reply sets Refresh's to whether a Refresh is still unanswered; before
 * E01-M01-FIX-20 it enabled Refresh outright, so an Open's reply re-enabled it
 * while its own request was still reading.
 */
function clickAndRecord(controls: WatchedControl[]): void {
  const scope = globalThis as unknown as PageScope;
  const settled: Settled[] = [];
  scope.settledControls = settled;
  const clicked = scope.performance.now();
  const buttons = controls.map((control) => {
    const button = scope.document.querySelector(control.selector);
    if (button === null) {
      throw new Error(`the bar has no ${control.selector}`);
    }
    new scope.MutationObserver(() => {
      if (button.textContent !== control.busy && !settled.some((s) => s.name === control.name)) {
        settled.push({ name: control.name, ms: Math.round(scope.performance.now() - clicked) });
      }
    }).observe(button, { childList: true, characterData: true, subtree: true });
    return button;
  });
  for (const button of buttons) {
    button.click();
  }
}

function settledControls(): Settled[] {
  return [...((globalThis as unknown as PageScope).settledControls ?? [])];
}

/** What one reply was, reduced to what this suite compares. */
type ReplySummary = { ok: true; rows: number; hasMore: boolean } | { ok: false; kind: string };

/** One request raced by an open of the small repository, and what each said. */
type RaceSummary = { order: string[]; raced: ReplySummary; open: ReplySummary };

/** Load More once over the bridge, without drawing, and say what it answered. */
async function loadMoreOnce(input: { count: number }): Promise<ReplySummary> {
  const reply = await (globalThis as unknown as PageScope).gitGraphical.loadMoreCommits(input);
  return reply.ok
    ? { ok: true, rows: reply.value.layout.rowCount, hasMore: reply.value.hasMore }
    : { ok: false, kind: reply.kind };
}

/**
 * Race `stale` — a Refresh or a Load More of the large repository — against an
 * Open of the small one dispatched right behind it, over the bridge alone, with
 * every reply kept; the window shows a cancelled reply as nothing, which is the
 * point of it and also why the window cannot say whether one happened. Repeated
 * until the open answers first, at most `attempts` times.
 */
async function raceAnOpen(input: {
  large: string;
  small: string;
  grow: number;
  more: number;
  stale: 'refresh' | 'load-more';
  attempts: number;
}): Promise<RaceSummary[]> {
  const bridge = (globalThis as unknown as PageScope).gitGraphical;
  type Reply = Awaited<ReturnType<GitGraphicalBridge['refresh']>>;
  const summary = (reply: Reply): ReplySummary =>
    reply.ok
      ? { ok: true, rows: reply.value.layout.rowCount, hasMore: reply.value.hasMore }
      : { ok: false, kind: reply.kind };
  const settle = (order: string[], name: string, reply: Promise<Reply>): Promise<Reply> =>
    reply.then((value) => {
      order.push(name);
      return value;
    });
  const attempts: RaceSummary[] = [];
  while (attempts.length < input.attempts && attempts.at(-1)?.order[0] !== 'open') {
    const opened = await bridge.openRepository({ path: input.large });
    const grown = await bridge.loadMoreCommits({ count: input.grow });
    if (!opened.ok || !grown.ok) {
      throw new Error('the large repository did not open and grow over the bridge');
    }
    const order: string[] = [];
    const stale =
      input.stale === 'refresh'
        ? bridge.refresh({})
        : bridge.loadMoreCommits({ count: input.more });
    const late = settle(order, input.stale, stale);
    const opening = settle(order, 'open', bridge.openRepository({ path: input.small }));
    const [raced, open] = await Promise.all([late, opening]);
    attempts.push({ order, raced: summary(raced), open: summary(open) });
  }
  return attempts;
}

/** A Refresh and a Load More of the same repository at once, and what each said. */
async function raceSameRepository(input: { count: number }): Promise<ReplySummary[]> {
  const bridge = (globalThis as unknown as PageScope).gitGraphical;
  const replies = await Promise.all([bridge.refresh({}), bridge.loadMoreCommits(input)]);
  return replies.map((reply) =>
    reply.ok
      ? { ok: true, rows: reply.value.layout.rowCount, hasMore: reply.value.hasMore }
      : { ok: false, kind: reply.kind },
  );
}

/* --- Driving the built application. --- */

/**
 * Launch the built application on `open`, run `body` against its window, and
 * stop it; the exit status is read back, because a leaked Electron process is a
 * failure whatever the assertions said, and the utility process is its child.
 */
async function withWindow(
  open: string,
  body: (page: Page, application: ElectronApplication) => Promise<void>,
): Promise<void> {
  const application = await electron.launch({ args: ['.', open], cwd: repositoryRoot });
  try {
    await body(await application.firstWindow(), application);
  } finally {
    const child = application.process();
    await application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

/**
 * Answer the folder dialog with `chosen`. It runs in the main process, which is
 * the only place it can be answered; the handler looks `showOpenDialog` up on
 * `dialog` at every call.
 */
async function answerTheDialog(application: ElectronApplication, chosen: string): Promise<void> {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, chosen);
}

/**
 * Round 15's sequence once, through the window: `large` open and grown, Refresh
 * then Open Repository of `small` clicked in one turn, both answered. Then the
 * window must show `small` whichever answered first, and a further page over the
 * bridge must be `small`'s. Returns the order the two controls finished in.
 */
async function refreshThenOpen(page: Page, large: string, small: string): Promise<string[]> {
  await expect(page.locator('.bar__path')).toHaveText(large);
  const rows = { rows: GROWN_ROWS, from: FIRST_PAGE_COMMITS };
  expect(await page.evaluate(growAndDraw, rows)).toBe(GROWN_ROWS);
  expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(GROWN_ROWS);
  await page.evaluate(clickAndRecord, [
    { name: 'refresh', selector: '.bar__refresh', busy: 'Refreshing…' },
    { name: 'open', selector: '.bar__open', busy: 'Opening…' },
  ]);
  await expect.poll(() => page.evaluate(settledControls)).toHaveLength(2);
  await expect(page.locator('.bar__open')).toBeEnabled();
  await expect(page.locator('.bar__refresh')).toBeEnabled();
  const settled = await page.evaluate(settledControls);
  process.stdout.write(`refresh then open, clicked: ${JSON.stringify(settled)}\n`);
  await expect(page.locator('.bar__path')).toHaveText(small);
  await expect(page.locator(FAILURE_HEADLINE)).toBeHidden();
  expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(3);
  await expect(page.locator(ROW).first()).toContainText('commit 3');
  await expect(page.locator(MORE)).toBeHidden();
  const further = await page.evaluate(loadMoreOnce, { count: FURTHER_PAGE_COMMITS });
  expect(further).toEqual({ ok: true, rows: 3, hasMore: false });
  return settled.map((control) => control.name);
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test('a refresh overtaken by an open never draws the repository it replaced', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  const small = fixture('tags', 'tags', 3);
  await withWindow(large, async (page, application) => {
    await expect(page.locator(MORE)).toBeVisible();
    const orders: string[][] = [];
    while (orders.length < ATTEMPTS && orders.at(-1)?.[0] !== 'open') {
      if (orders.length > 0) {
        await answerTheDialog(application, large);
        await page.locator('.bar__open').click();
        await expect(page.locator(MORE)).toBeVisible();
      }
      await answerTheDialog(application, small);
      orders.push(await refreshThenOpen(page, large, small));
    }
    // The ordering this case exists for: the open answered while the refresh of
    // the other repository was still reading.
    expect(orders.at(-1)).toEqual(['open', 'refresh']);
  });
});

test('over the bridge, only a reply for a repository since replaced is dropped', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  const small = fixture('tags', 'tags', 3);
  await withWindow(large, async (page) => {
    await expect(page.locator(MORE)).toBeVisible();
    const grown = GROWN_ROWS - FURTHER_PAGE_COMMITS;
    const rows = { rows: grown, from: FIRST_PAGE_COMMITS };
    expect(await page.evaluate(growAndDraw, rows)).toBe(grown);
    // Whichever of the two lands first, each answers its own page and neither fails.
    expect(await page.evaluate(raceSameRepository, { count: FURTHER_PAGE_COMMITS })).toEqual([
      { ok: true, rows: grown, hasMore: true },
      { ok: true, rows: GROWN_ROWS, hasMore: false },
    ]);
    const smallPage = { ok: true, rows: 3, hasMore: false };
    for (const stale of ['refresh', 'load-more'] as const) {
      const grow = grown - FIRST_PAGE_COMMITS;
      const input = { large, small, grow, more: FURTHER_PAGE_COMMITS, stale, attempts: ATTEMPTS };
      const attempts = await page.evaluate(raceAnOpen, input);
      process.stdout.write(`${stale} raced by an open: ${JSON.stringify(attempts)}\n`);
      for (const attempt of attempts) {
        // Dropped if the open was applied first; its own whole page otherwise.
        const own = stale === 'refresh' ? grown : GROWN_ROWS;
        const expected =
          attempt.order[0] === 'open'
            ? { ok: false, kind: FailureKind.Cancelled }
            : { ok: true, rows: own, hasMore: own < GROWN_ROWS };
        expect(attempt).toEqual({ order: attempt.order, raced: expected, open: smallPage });
      }
      expect(attempts.at(-1)?.order).toEqual(['open', stale]);
    }
    expect(await page.evaluate(loadMoreOnce, { count: FURTHER_PAGE_COMMITS })).toEqual(smallPage);
  });
});
