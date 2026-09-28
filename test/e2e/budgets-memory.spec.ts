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
 * add two more loads of fifty thousand and ten more minutes to a gate that
 * already runs for hours. Each budget is compared separately and every
 * comparison is made before any assertion fails, so one red budget does not
 * hide the verdicts of the others.
 *
 * ### What is read, and from where
 *
 * - **Memory** is read from the operating system's process table
 *   (`processTree` in `./support/budgets.ts`): every process descended from the
 *   application's main process, whose identifier the main process reports
 *   itself — not the process Playwright spawned, which on Windows is a
 *   `cmd.exe` shim above it and is not the application. On 2026-09-28 that was
 *   five processes: main, the GPU process, the network service, the renderer and
 *   the utility process of `src/app/repository-client.ts`; the case requires at
 *   least the four this project's code starts or draws in.
 * - **Resident memory is the sum of the working sets.** That is what "resident"
 *   and "all processes" say, and it counts a page shared by several processes —
 *   Electron's own code, mapped into all five — once for each. The private bytes
 *   are printed beside it, as the reading that counts nothing twice and misses
 *   what is shared; the true figure lies between the two. The budget is held
 *   against the first, because it is the one the budget names.
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

/** Time for the load's own collections to finish before the idle window opens. */
const SETTLE_MS = 10_000;

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
 * Reading the main process's count is itself a callback there, so it is read
 * twice at the end and the second read's own cost is subtracted.
 */
async function idle(budgeted: Budgeted, main: number): Promise<IdleReading> {
  const { application, page } = budgeted;
  await application.evaluate(countMainCallbacks);
  const mainBefore = sum(await application.evaluate(readMainCallbacks));
  const pageBefore = await page.evaluate(readProbe);
  const before = processTree(main);
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  const after = processTree(main);
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
      'residentBytesAt50000',
      'resident memory, every process, 50000 commits',
      total(loaded, 'workingSet'),
    ).failed,
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

/** Hold what is still resident of `loaded` once the window has closed. */
function closedVerdicts(loaded: readonly ProcessReading[]): boolean[] {
  const left = stillRunning(loaded);
  process.stdout.write(
    `  after the window closed: ${String(left.length)} of the ${String(loaded.length)} processes ` +
      `still running, ${mebibytes(total(left, 'workingSet'))} still resident
`,
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
  test.setTimeout(IDLE_MS + 300_000);
  const repository = fixture('huge', 'large', COMMITS);
  const budgeted = await launchBudgeted({ open: repository });
  const held: { loaded: readonly ProcessReading[]; verdicts: boolean[] } = {
    loaded: [],
    verdicts: [],
  };
  try {
    await loadFiftyThousand(budgeted, repository);
    const main = await budgeted.application.evaluate(() => process.pid);
    await budgeted.page.waitForTimeout(SETTLE_MS);
    held.loaded = processTree(main);
    held.verdicts.push(...memoryVerdicts(held.loaded));
    held.verdicts.push(...idleVerdicts(await idle(budgeted, main)));
  } finally {
    await closeBudgeted(budgeted);
  }
  held.verdicts.push(...closedVerdicts(held.loaded));
  expect(held.verdicts).toEqual(held.verdicts.map(() => false));
});
