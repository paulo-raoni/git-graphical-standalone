import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import type { GitGraphicalBridge, GraphPage } from '../../src/contracts/index';
import { FIRST_PAGE_COMMITS, FURTHER_PAGE_COMMITS } from '../../src/core/page/index';
import { ROW_HEIGHT } from '../../src/ui/geometry';
import { fixture } from './support/fixtures';

/**
 * Refresh is disabled until its own request is answered, and then says `Refresh`.
 *
 * Review round 16 of E01-M01 drove this through the built application (finding
 * F-37): the ten-thousand-commit fixture grown to 9 000 rows, Load More pressed,
 * Refresh pressed 150 ms later, and the Load More's reply re-enabled Refresh
 * while its own request was still reading and its label still said
 * `Refreshing…`. Pressed again then, it ended enabled, idle and labelled
 * `Refreshing…`, and stayed so. This suite drives the same sequence, presses
 * Refresh again the first time it is seen enabled with its request unanswered,
 * and requires that it never was, and that it ends enabled and saying `Refresh`.
 *
 * **The ordering is a race, so it is required rather than assumed, and retried
 * rather than hoped for**, as `test/e2e/superseded-reply.spec.ts` does. Every
 * attempt's end state is asserted whichever request answered first; an attempt
 * in which the Load More was not answered while the Refresh was unanswered is
 * repeated, up to {@link ATTEMPTS} times, and the case fails if that ordering
 * never occurred.
 *
 * **A request is unanswered while its control has fewer label writes than twice
 * its presses.** Each press writes the busy label once, synchronously, and the
 * answer writes the resting label once, in a `finally`; setting `textContent`
 * replaces the text node, so a write is a mutation record even when the text is
 * the same. One observer watches both controls, so their records arrive in the
 * order they happened, and every press flushes the records before and after it.
 * Whether Refresh is enabled is read at every batch of records, which is at the
 * end of every task that changed either control.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Long enough for the ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

/** How many times the race is run before the case gives up on seeing its ordering. */
const ATTEMPTS = 4;

/** Round 16's size, and its delay between the two presses. */
const GROWN_ROWS = 9_000;
const REFRESH_DELAY_MS = 150;

const MORE = '.graph__more';
const REFRESH = '.bar__refresh';

/* --- What runs inside the page. `tsconfig.node.json` has no DOM library, so
   every element this touches is described here rather than borrowed. --- */

interface Control {
  readonly textContent: string | null;
  readonly disabled: boolean;
  readonly clientHeight: number;
  click(): void;
}

type Records = readonly {
  readonly target: unknown;
  readonly addedNodes: ArrayLike<{ readonly textContent: string | null }>;
}[];

interface Observer {
  readonly observe: (target: Control, options: { childList: true; attributes: true }) => void;
  readonly takeRecords: () => Records;
  readonly disconnect: () => void;
}

type Name = 'refresh' | 'more';

/** What one race saw, kept in the page and read back by {@link raceState}. */
type Race = {
  starts: Record<Name, number>;
  /** Every label written on each control, in order: one when pressed, one when answered. */
  labels: Record<Name, (string | null)[]>;
  /** The label Refresh showed each time it was seen enabled with its request unanswered. */
  enabledWhileUnanswered: (string | null)[];
  /** Whether the Load More was answered while the Refresh was unanswered; `null` until it was. */
  overlapped: boolean | null;
};

interface PageScope {
  readonly document: { readonly querySelector: (selector: string) => Control | null };
  readonly gitGraphical: GitGraphicalBridge;
  readonly gitGraphicalView?: { readonly showPage: (page: GraphPage) => void };
  readonly MutationObserver: new (callback: (records: Records) => void) => Observer;
  readonly setTimeout: (callback: () => void, ms: number) => void;
  race?: Race;
  raceObserver?: Observer;
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

/**
 * Press Load More, then Refresh `delay` milliseconds later, and keep what the
 * two controls do in `race`. Refresh is pressed once more, as round 16 did, the
 * first time it is seen enabled while its request is unanswered.
 */
function pressLoadMoreThenRefresh(delay: number): void {
  const scope = globalThis as unknown as PageScope;
  const refresh = scope.document.querySelector('.bar__refresh');
  const more = scope.document.querySelector('.graph__more');
  if (refresh === null || more === null) {
    throw new Error('the window has no Refresh or no Load More control');
  }
  scope.raceObserver?.disconnect();
  const race: Race = {
    starts: { refresh: 0, more: 0 },
    labels: { refresh: [], more: [] },
    enabledWhileUnanswered: [],
    overlapped: null,
  };
  scope.race = race;
  const unanswered = (name: Name): number => 2 * race.starts[name] - race.labels[name].length;
  const handle = (records: Records): void => {
    for (const record of records.filter((each) => each.addedNodes.length > 0)) {
      const name: Name = record.target === refresh ? 'refresh' : 'more';
      race.labels[name].push(record.addedNodes[0]?.textContent ?? null);
      if (name === 'more' && unanswered('more') === 0) {
        race.overlapped = unanswered('refresh') > 0;
      }
    }
  };
  const press = (name: Name, control: Control): void => {
    handle(observer.takeRecords());
    if (!control.disabled) {
      control.click();
      race.starts[name] += 1;
    }
    handle(observer.takeRecords());
  };
  const observer = new scope.MutationObserver((records) => {
    handle(records);
    if (!refresh.disabled && unanswered('refresh') > 0) {
      race.enabledWhileUnanswered.push(refresh.textContent);
      if (race.starts.refresh === 1) {
        press('refresh', refresh);
      }
    }
  });
  scope.raceObserver = observer;
  observer.observe(refresh, { childList: true, attributes: true });
  observer.observe(more, { childList: true, attributes: true });
  press('more', more);
  scope.setTimeout(() => {
    press('refresh', refresh);
  }, delay);
}

/** What the race recorded, and what the two controls show now. */
function raceState(): (Race & { refresh: string; more: string; settled: boolean }) | null {
  const scope = globalThis as unknown as PageScope;
  const race = scope.race;
  const refresh = scope.document.querySelector('.bar__refresh');
  const more = scope.document.querySelector('.graph__more');
  if (race === undefined || refresh === null || more === null) {
    return null;
  }
  const shown = (control: Control): string =>
    `${control.disabled ? 'disabled' : 'enabled'} ${String(control.textContent)}`;
  const answered = (name: Name): boolean => race.labels[name].length === 2 * race.starts[name];
  return {
    ...structuredClone(race),
    refresh: shown(refresh),
    more: shown(more),
    settled: race.starts.refresh > 0 && answered('refresh') && answered('more'),
  };
}

/**
 * What the control at `selector` shows, whether it is enabled and its label,
 * after pressing it first when `press` says so. The click handler runs inside
 * `click()`, so a press that started a request reads disabled and busy here,
 * before any reply can have been drawn.
 */
function shownAt(input: { selector: string; press: boolean }): string {
  const control = (globalThis as unknown as PageScope).document.querySelector(input.selector);
  if (control === null) {
    throw new Error(`the window has no ${input.selector}`);
  }
  if (input.press) {
    control.click();
  }
  return `${control.disabled ? 'disabled' : 'enabled'} ${String(control.textContent)}`;
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

/** Answer the folder dialog with `chosen`, in the main process, which is the only place it can be. */
async function answerTheDialog(application: ElectronApplication, chosen: string): Promise<void> {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, chosen);
}

/**
 * Round 16's sequence once: `large` just opened, grown to {@link GROWN_ROWS}
 * rows, Load More and then Refresh pressed. Waits until every request either
 * control started is answered, requires the end state, and says whether the
 * Load More was answered while the Refresh was unanswered.
 */
async function loadMoreThenRefresh(page: Page, large: string): Promise<boolean | null> {
  await expect(page.locator('.bar__path')).toHaveText(large);
  await expect(page.locator(MORE)).toBeVisible();
  await expect(page.locator(REFRESH)).toBeEnabled();
  expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(FIRST_PAGE_COMMITS);
  const rows = { rows: GROWN_ROWS, from: FIRST_PAGE_COMMITS };
  expect(await page.evaluate(growAndDraw, rows)).toBe(GROWN_ROWS);
  await page.evaluate(pressLoadMoreThenRefresh, REFRESH_DELAY_MS);
  await expect.poll(() => page.evaluate(raceState)).toMatchObject({ settled: true });
  const race = await page.evaluate(raceState);
  process.stdout.write(`load more then refresh: ${JSON.stringify(race)}\n`);
  expect(race).toEqual({
    starts: { refresh: 1, more: 1 },
    labels: { refresh: ['Refreshing…', 'Refresh'], more: ['Loading…', 'Load More Commits'] },
    enabledWhileUnanswered: [],
    overlapped: race?.overlapped,
    refresh: 'enabled Refresh',
    more: 'enabled Load More Commits',
    settled: true,
  });
  return race?.overlapped ?? null;
}

/** How long one reply on the ten-thousand-commit fixture is waited for. */
const REPLY_MS = 60_000;

/**
 * Press the control at `selector`, require that the press started a request,
 * and wait on that same control until its own request is answered: its resting
 * label is written in a `finally`, after the reply has been drawn.
 */
async function pressAndAwait(
  page: Page,
  selector: string,
  labels: { busy: string; resting: string },
): Promise<void> {
  expect(await page.evaluate(shownAt, { selector, press: true })).toBe(`disabled ${labels.busy}`);
  await expect(page.locator(selector)).toHaveText(labels.resting, { timeout: REPLY_MS });
}

/**
 * Read Refresh once, now, and require it usable: a repository is shown and no
 * Refresh of its own is unanswered. Read once rather than waited on, so a later
 * write cannot make a wrong state pass.
 */
async function expectRefreshUsable(page: Page): Promise<void> {
  expect(await page.evaluate(shownAt, { selector: REFRESH, press: false })).toBe('enabled Refresh');
}

test.beforeAll(() => {
  if (!existsSync(join(repositoryRoot, 'dist', 'main.cjs'))) {
    throw new Error('run `npm run build` before the end-to-end gate');
  }
});

test('refresh stays disabled until its own reply, whatever is answered meanwhile', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow(large, async (page, application) => {
    const overlaps: (boolean | null)[] = [];
    while (overlaps.length < ATTEMPTS && overlaps.at(-1) !== true) {
      if (overlaps.length > 0) {
        await answerTheDialog(application, large);
        await page.locator('.bar__open').click();
        await expect(page.locator('.bar__open')).toHaveText('Open Repository');
      }
      overlaps.push(await loadMoreThenRefresh(page, large));
    }
    // The ordering this case exists for: the Load More was answered while the
    // Refresh was still reading.
    expect(overlaps.at(-1)).toBe(true);
  });
});

/*
 * Review round 17 of E01-M01 (finding F-38) removed the line that takes Refresh
 * out of the renderer's busy set once its own request is answered, and every
 * gate stayed green, while the window's Refresh ended dead after the first
 * Refresh followed by a Load More: each later reply disables it again. This
 * case answers one request at a time, so no ordering is left to chance, and
 * reads Refresh after each reply has been drawn.
 */
test('refresh is usable again after its own reply, whatever is answered after it', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withWindow(large, async (page, application) => {
    await expect(page.locator('.bar__path')).toHaveText(large);
    await expect(page.locator(REFRESH)).toBeEnabled();
    await pressAndAwait(page, REFRESH, { busy: 'Refreshing…', resting: 'Refresh' });
    await expectRefreshUsable(page);
    const rows = await page.evaluate(tableRows, ROW_HEIGHT);
    await pressAndAwait(page, MORE, { busy: 'Loading…', resting: 'Load More Commits' });
    expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(rows + FURTHER_PAGE_COMMITS);
    // A Load More answered after the Refresh leaves Refresh usable.
    await expectRefreshUsable(page);
    await answerTheDialog(application, large);
    await pressAndAwait(page, '.bar__open', { busy: 'Opening…', resting: 'Open Repository' });
    expect(await page.evaluate(tableRows, ROW_HEIGHT)).toBe(FIRST_PAGE_COMMITS);
    // So does an Open answered after both.
    await expectRefreshUsable(page);
  });
});
