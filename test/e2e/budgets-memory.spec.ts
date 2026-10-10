import { expect, test } from '@playwright/test';

import {
  closeBudgeted,
  holdToBaseline,
  launchBudgeted,
  paintedState,
  processTree,
  stillRunning,
  total,
} from './support/budgets';
import type { Budgeted, ProcessReading } from './support/budgets';
import { loadMoreAndShow, readProbe } from './support/budgets-page';
import type { ProbeReading } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * Memory with fifty thousand commits loaded, five real minutes of a visible
 * window doing nothing, and what closing the window gives back
 * (`docs/ADR-0002-architecture-and-performance.md` decision 6, three rows, and
 * E01-M01-S06's items 4 and 5).
 *
 * **One case, on purpose.** The idle window has to follow a load, and the load
 * worth idling after is the largest one; a second launch for each budget would
 * add two more loads of fifty thousand and ten more minutes to a gate whose
 * one run of this case already waits five idle minutes, and up to three before
 * them for the settle. That gate is `npm run gates:budgets`: the case is on the
 * `BUDGETS` list of `playwright.config.js`, and neither `gates:e2e` nor
 * `npm run gates` runs it (`AGENTS.md` §11, *Gate tiers*). Each budget is
 * compared separately and every comparison is made before any assertion fails,
 * so one red budget does not hide the verdicts of the others.
 *
 * ### What is read, and from where
 *
 * - **Memory** is read from the operating system's process table
 *   (`processTree` in `./support/budgets.ts`, narrowed by `applicationTree`
 *   below): every process descended from the application's main process, whose
 *   identifier the main process reports itself — not the process Playwright
 *   spawned, which on Windows is a `cmd.exe` shim above it and is not the
 *   application. On 2026-09-28 that was five processes: main, the GPU process,
 *   the network service, the renderer and the utility process of
 *   `src/app/repository-client.ts`; the case requires at least the four this
 *   project's code starts or draws in. It is read once the load's memory has
 *   been given back (`SETTLE`), and the idle window opens after that reading.
 * - **The budget is held against the sum of the private bytes** of every
 *   process, by the owner's ruling recorded in decision 6 as amended on
 *   2026-10-03: that sum counts nothing twice. The sum of the working sets is
 *   printed beside it and held to nothing. It counts a page shared by several
 *   processes — Electron's own code, mapped into all five — once for each, and
 *   it moves with how hard the rest of the machine presses for memory, which no
 *   tolerance this gate could carry would cover without flapping.
 * - **CPU while idle** is the processes' kernel and user time, read from the same
 *   table before and after the five minutes, as a percentage of one core.
 * - **Wakeups** are counted inside the page by the init scripts of
 *   `./support/budgets-page.ts` — every `setTimeout`, `setInterval`,
 *   `requestAnimationFrame` and `requestIdleCallback` callback that runs — and
 *   inside the main process by an `async_hooks` hook, which sees every callback
 *   Node runs there: a timer, an immediate, a socket, a message. What neither
 *   sees is work Chromium schedules for itself outside JavaScript, and the
 *   processes' CPU time above is what covers that.
 */

/** Five real minutes, which the budget names and this case does not shorten. */
const IDLE_MS = 5 * 60 * 1000;

/**
 * When the memory is read, and when the idle window opens: once the sum of the
 * private bytes has **stopped falling**: when a reading at least `windowMs`
 * old exists, and from the newest such reading to the newest reading of all no
 * reading is `fallBytes` or more below one before it and every reading holds
 * the same processes. A rise does not hold the rule back, so a leak is left for
 * the budgets to judge; a fall after a rise does. The tree is read every
 * `pauseMs` plus the time a reading takes. Past `capMs` after the paint the
 * case fails instead of reading.
 *
 * Why: the load's memory is not given back at once but in steps. Measured by
 * E01-M01-FIX-28 on 2026-10-03, 15:50 to 16:03, in five launches whose tree was
 * read every 3.1 to 3.6 s for 120 s after the paint (processor load 13 to
 * 100 %, 3.0 to 3.9 GB free): the GPU process gave back 9.3 to 10.1 MB in two
 * steps by 10.6 s and 4.6 MB more between 30.1 and 36.8 s; the renderer 6.2 to
 * 7.6 MB between 23.1 and 30.4 s; the utility process 15.3 to 16.6 MB between
 * 25.5 and 30.8 s; the main process 1.5 to 1.8 MB between 50.6 and 58.4 s.
 * Nothing moved by 1 MB from then to 120 s. The sum read 199.9 to 204.2 MB at
 * the paint, 190.2 to 194.6 at ten seconds and 158.0 to 163.2 at 120. The
 * longest still stretch between two steps was 15 to 20 s by the nearest
 * readings, 26 s at most between them, so a window of 40 s is not met inside
 * one; 1 MB is under the smallest step, the main process's 1.5. Applied to
 * those five curves the rule was met 96.6 to 99.3 s after the paint, within
 * 0.11 MB of the 120 s reading.
 *
 * What it does not catch is a step that comes more than 40 s after the one
 * before it. In 22 runs of this case that day, eleven of them before the rule
 * asked for the same processes (processor load 8 to 100 %, 0.08 to 5.9 GB
 * free), the rule was met 68.7 to 124.4 s after the paint; in 20 the sum then
 * moved by -1.0 to +0.5 MiB over the five idle minutes, and in two, both at a
 * load of 52 to 100 %, the GPU process gave back 3.1 and 4.3 MiB during them.
 */
const SETTLE = { windowMs: 40_000, fallBytes: 1_000_000, pauseMs: 2_000, capMs: 180_000 };

const COMMITS = 50_000;

/** Runs in the main process: count every callback Node runs there, by resource type. */
function countMainCallbacks(): void {
  interface Hooks {
    createHook: (callbacks: {
      init: (id: number, type: string) => void;
      before: (id: number) => void;
      destroy: (id: number) => void;
    }) => { enable: () => void };
  }
  const load = (process as unknown as { getBuiltinModule: (name: string) => unknown })
    .getBuiltinModule;
  const hooks = load('node:async_hooks') as Hooks;
  const ran: Record<string, number> = {};
  const types = new Map<number, string>();
  const hook = hooks.createHook({
    init: (id, type) => {
      types.set(id, type);
    },
    before: (id) => {
      const type = types.get(id) ?? 'created before counting began';
      ran[type] = (ran[type] ?? 0) + 1;
    },
    destroy: (id) => {
      types.delete(id);
    },
  });
  hook.enable();
  Object.assign(globalThis, { budgetMainCallbacks: { ran, hook } });
}

/** Runs in the main process: the callbacks counted so far. */
function readMainCallbacks(): Record<string, number> {
  const counting = (
    globalThis as unknown as { budgetMainCallbacks?: { ran: Record<string, number> } }
  ).budgetMainCallbacks;
  return { ...(counting?.ran ?? {}) };
}

function sum(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((all, one) => all + one, 0);
}

function mebibytes(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
}

function describeTree(label: string, tree: readonly ProcessReading[]): void {
  process.stdout.write(
    `  ${label}: ${String(tree.length)} processes, working sets ${mebibytes(total(tree, 'workingSet'))}, ` +
      `private ${mebibytes(total(tree, 'privateBytes'))}, cpu ${total(tree, 'cpuMilliseconds').toFixed(0)} ms\n`,
  );
  for (const each of tree) {
    process.stdout.write(
      `    ${String(each.pid)} ${each.name} ws ${mebibytes(each.workingSet)} ` +
        `private ${mebibytes(each.privateBytes)} cpu ${each.cpuMilliseconds.toFixed(0)} ms\n`,
    );
  }
}

/**
 * The processes of the application: `processTree` from its main process, less
 * any process created before the parent it names. Windows reuses process
 * identifiers, and a process keeps the identifier of a parent that has ended,
 * so a program started before this application can name as its parent an
 * identifier one of this application's processes now holds. On 2026-10-03 one
 * launch of six read by E01-M01-FIX-28 was given the identifier Microsoft
 * Edge's ended launcher had held, and the tree took in sixteen Edge processes,
 * about 900 MB of private bytes; a child is never created before its parent.
 */
function applicationTree(main: number): readonly ProcessReading[] {
  const tree = processTree(main);
  const kept = tree.filter((each) => each.pid === main);
  for (let grew = true; grew;) {
    const added = tree.filter(
      (each) =>
        !kept.includes(each) &&
        kept.some((parent) => parent.pid === each.parent && each.createdAt >= parent.createdAt),
    );
    kept.push(...added);
    grew = added.length > 0;
  }
  return kept;
}

interface Timed {
  /** Milliseconds after the paint. */
  readonly at: number;
  readonly sum: number;
  /** The identifiers of the processes read, in order. */
  readonly processes: string;
}

/** Whether the newest of `readings`, oldest first, meets the rule of {@link SETTLE}. */
function stoppedFalling(readings: readonly Timed[]): boolean {
  const newest = readings.at(-1);
  const from = readings.findLastIndex((each) => each.at <= (newest?.at ?? 0) - SETTLE.windowMs);
  const window = readings.slice(Math.max(from, 0));
  let highest = 0;
  let fall = 0;
  for (const each of window) {
    highest = Math.max(highest, each.sum);
    fall = Math.max(fall, highest - each.sum);
  }
  const same = window.every((each) => each.processes === newest?.processes);
  return from >= 0 && fall < SETTLE.fallBytes && same;
}

/**
 * Read the application's processes every few seconds from `painted` until the
 * sum of their private bytes has stopped falling, and return the reading that
 * met the rule. Throws past the cap: a reading taken early is the defect this
 * replaces.
 *
 * Why the same processes: 120 s after its GPU process starts, the main process
 * starts a second one (`--type=gpu-process --disable-gpu-sandbox
 * --use-gl=disabled` and the graphics card's identifiers) that soon ends.
 * Watched by E01-M01-FIX-28 on 2026-10-03 in six launches polled about every
 * 1.3 s: seen in four, created 119.99 to 120.01 s after the first, with a
 * working set of 71 to 99 MiB and 7 to 25 MiB of private bytes when read, and
 * gone by the next poll, 1.2 to 2.4 s after it was created. That falls about
 * when the rule is met: in one of five runs of this case that day, a reading
 * taken a second after the rule was met, 107 s after the paint, held it. A
 * reading that holds it measures those seconds and not the loaded application.
 */
async function settle(
  budgeted: Budgeted,
  main: number,
  painted: number,
): Promise<readonly ProcessReading[]> {
  const readings: Timed[] = [];
  for (;;) {
    const tree = applicationTree(main);
    const at = Date.now() - painted;
    const processes = tree.map((each) => String(each.pid)).join(' ');
    readings.push({ at, sum: total(tree, 'privateBytes'), processes });
    const shown = readings.map((each) => `${(each.at / 1000).toFixed(1)} s ${mebibytes(each.sum)}`);
    if (stoppedFalling(readings)) {
      process.stdout.write(
        `  settled ${(at / 1000).toFixed(1)} s after the paint: ${shown.join(', ')}\n`,
      );
      return tree;
    }
    if (at > SETTLE.capMs) {
      throw new Error(`the memory had not settled at the cap: ${shown.join(', ')}`);
    }
    await budgeted.page.waitForTimeout(SETTLE.pauseMs);
  }
}

/** Open the fixture, load all fifty thousand commits and wait until they are painted. */
async function loadFiftyThousand(budgeted: Budgeted, repository: string): Promise<void> {
  const { page } = budgeted;
  await paintedState(page, (state) => state.path === repository && state.rows === 300);
  const loaded = await page.evaluate(loadMoreAndShow, COMMITS - 300);
  expect(loaded.commits).toBe(COMMITS);
  await paintedState(page, (state) => state.rows === COMMITS && state.ink > 0);
  process.stdout.write(
    `  loaded ${String(COMMITS)} commits in ${loaded.milliseconds.toFixed(0)} ms\n`,
  );
}

interface IdleReading {
  readonly before: readonly ProcessReading[];
  readonly after: readonly ProcessReading[];
  readonly page: number;
  readonly redraws: number;
  readonly main: number;
}

function firedDelta(before: ProbeReading, after: ProbeReading): number {
  return sum(after.fired) - sum(before.fired);
}

/**
 * Five minutes with nothing touched: the processes before and after, and the
 * wakeups in the page and the main process between.
 *
 * `before` is the reading that met the rule of {@link SETTLE}, so the window
 * opens on a tree known to be at rest: a second reading taken here could hold
 * the short-lived process described at `settle`, as one did on 2026-10-03.
 *
 * Reading the main process's count is itself a callback there, so it is read
 * twice at the end and the second read's own cost is subtracted.
 */
async function idle(
  budgeted: Budgeted,
  main: number,
  before: readonly ProcessReading[],
): Promise<IdleReading> {
  const { application, page } = budgeted;
  await application.evaluate(countMainCallbacks);
  const mainBefore = sum(await application.evaluate(readMainCallbacks));
  const pageBefore = await page.evaluate(readProbe);
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  const after = applicationTree(main);
  const pageAfter = await page.evaluate(readProbe);
  const mainAfter = await application.evaluate(readMainCallbacks);
  const reread = sum(await application.evaluate(readMainCallbacks));
  process.stdout.write(`  main-process callbacks while idle: ${JSON.stringify(mainAfter)}\n`);
  return {
    before,
    after,
    page: firedDelta(pageBefore, pageAfter),
    redraws: pageAfter.redraws - pageBefore.redraws,
    main: sum(mainAfter) - mainBefore - (reread - sum(mainAfter)),
  };
}

/** Hold the memory of the loaded application; the verdicts, one per budget. */
function memoryVerdicts(loaded: readonly ProcessReading[]): boolean[] {
  describeTree(`${String(COMMITS)} commits loaded`, loaded);
  expect(loaded.length).toBeGreaterThanOrEqual(4);
  return [
    holdToBaseline(
      'privateBytesAt50000',
      'private memory, every process, 50000 commits',
      total(loaded, 'privateBytes'),
    ).failed,
  ];
}

/** Hold the five idle minutes; the verdicts, one per budget. */
function idleVerdicts(reading: IdleReading): boolean[] {
  describeTree('after five idle minutes', reading.after);
  const ratio = total(reading.after, 'workingSet') / total(reading.before, 'workingSet');
  const cpu = total(reading.after, 'cpuMilliseconds') - total(reading.before, 'cpuMilliseconds');
  return [
    holdToBaseline(
      'idleResidentRatio',
      'resident memory after five idle minutes over before',
      ratio,
    ).failed,
    holdToBaseline('idleCpuPerCent', 'processor time while idle', (cpu / IDLE_MS) * 100).failed,
    holdToBaseline(
      'idlePageWakeups',
      'timer and frame callbacks in the page while idle',
      reading.page,
    ).failed,
    holdToBaseline('idleRedraws', 'canvas redraws while idle', reading.redraws).failed,
    holdToBaseline('idleMainWakeups', 'callbacks in the main process while idle', reading.main)
      .failed,
  ];
}

/**
 * Close the window the way a person does, and wait for the application to end.
 *
 * Not `ElectronApplication.close`, which calls `app.quit` itself and would
 * measure Playwright's way of ending the application rather than this one's:
 * closing the last window is what reaches `window-all-closed` in
 * `src/app/main.ts`, which stops the utility process and quits. Waits up to
 * thirty seconds for the main process to exit, and reports rather than throws
 * when it does not, so that what is still running is read either way.
 */
async function closeTheWindow(budgeted: Budgeted): Promise<void> {
  const child = budgeted.launched;
  const exited = new Promise<boolean>((resolve) => {
    if (child.exitCode !== null) resolve(true);
    child.once('exit', () => {
      resolve(true);
    });
    setTimeout(() => {
      resolve(false);
    }, 30_000);
  });
  await budgeted.application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  const ended = (await exited) ? 'exited' : 'was still running 30 s';
  process.stdout.write(`  the main process ${ended} after the window closed\n`);
}

/** Hold what is still resident of `loaded` once the window has closed. */
function closedVerdicts(loaded: readonly ProcessReading[]): boolean[] {
  const left = stillRunning(loaded);
  process.stdout.write(
    `  after the window closed: ${String(left.length)} of the ${String(loaded.length)} processes ` +
      `still running, ${mebibytes(total(left, 'workingSet'))} still resident\n`,
  );
  return [
    holdToBaseline(
      'residentBytesAfterClose',
      'resident memory after closing',
      total(left, 'workingSet'),
    ).failed,
  ];
}

test('fifty thousand commits: memory, five idle minutes, and what closing gives back', async () => {
  test.setTimeout(IDLE_MS + SETTLE.capMs + 180_000);
  const repository = fixture('huge', 'large', COMMITS);
  const budgeted = await launchBudgeted({ open: repository });
  const held: { loaded: readonly ProcessReading[]; verdicts: boolean[] } = {
    loaded: [],
    verdicts: [],
  };
  try {
    await loadFiftyThousand(budgeted, repository);
    const painted = Date.now();
    const main = await budgeted.application.evaluate(() => process.pid);
    held.loaded = await settle(budgeted, main, painted);
    held.verdicts.push(...memoryVerdicts(held.loaded));
    held.verdicts.push(...idleVerdicts(await idle(budgeted, main, held.loaded)));
    await closeTheWindow(budgeted);
    held.verdicts.push(...closedVerdicts(held.loaded));
  } finally {
    await closeBudgeted(budgeted);
  }
  expect(held.verdicts).toEqual(held.verdicts.map(() => false));
});
