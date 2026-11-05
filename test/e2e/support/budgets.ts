import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import type { ElectronApplication, Page } from '@playwright/test';

import { compareInRegime, readBaselines } from '../../../perf/baselines';
import type { Comparison } from '../../../perf/baselines';

import {
  installPaintMarks,
  installProbe,
  installRedrawCounter,
  installStateReader,
  installTimerCounters,
  readInstalled,
  readProbe,
} from './budgets-page';
import type { PaintMark, PaintState } from './budgets-page';

/**
 * What the end-to-end budget suites share on the Node side: launching the built
 * application with the probes of `./budgets-page.ts` in place, reading its
 * processes from the operating system, waiting for a painted state, and holding
 * a measurement against `perf/baselines.json`.
 *
 * **Every comparison goes through {@link holdToBaseline}**, which calls
 * `compareInRegime` in `perf/baselines.ts`, which calls `compareWithBaseline`.
 * That is the one line a budget reaches the ratchet through, so a suite that
 * measured something and did not compare it would have to have skipped this
 * function, which each case's assertion on the comparison it returns makes
 * visible.
 *
 * **The suites that use this run in two gates** (`AGENTS.md` §11, *Gate
 * tiers*). The cases held to a clock carry the `@budgets` tag that
 * `playwright.config.js` selects by, and run in `npm run gates:budgets`
 * alone; the cases that hold counts or bytes through the same helpers —
 * `budgets-git.spec.ts`, `golden-graph.spec.ts` and two of
 * `budgets-frames.spec.ts` — run in `gates:e2e`.
 */

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const baselines = readBaselines();

/** A launched application, its window, and when it was asked for. */
export interface Budgeted {
  readonly application: ElectronApplication;
  readonly page: Page;
  /** `Date.now()` just before `electron.launch` was called. */
  readonly launchedAt: number;
  /**
   * The process Playwright started, taken at launch: once the application has
   * ended by itself, `application.process()` can no longer be asked.
   */
  readonly launched: ChildProcess;
  /** The user-data directory made for this launch, removed by {@link closeBudgeted}. */
  readonly home: string;
  /** Whether the first window was reloaded because an init script missed its first document. */
  readonly reloaded: boolean;
}

/** What to launch with: a folder, an environment, and Chromium switches. */
export interface LaunchOptions {
  readonly open?: string;
  readonly env?: Record<string, string>;
  readonly switches?: readonly string[];
}

/** The init scripts of `./budgets-page.ts`, in the order they are added and run. */
const INIT_SCRIPTS = [
  installProbe,
  installStateReader,
  installPaintMarks,
  installTimerCounters,
  installRedrawCounter,
] as const;

/**
 * The renderer's document of `page` once its view exists, and what the init
 * scripts recorded in it. Polled from here, with the page's own timers left
 * alone, because a wait run in the page would be counted by the probe.
 */
async function installedInView(page: Page): Promise<readonly boolean[] | null> {
  const until = Date.now() + 60_000;
  for (;;) {
    const installed = await page.evaluate(readInstalled).catch(() => null);
    if (installed?.view === true) {
      return installed.beforeRenderer;
    }
    if (Date.now() > until) {
      throw new Error('the renderer never published its view');
    }
    await page.waitForTimeout(20);
  }
}

/**
 * Launch the built application as the other end-to-end suites do, on a
 * user-data directory of its own, with the five init scripts of
 * `./budgets-page.ts` in its first window's document before `renderer.js` runs,
 * and refuse the launch if any of them ran after the renderer had.
 *
 * **The scripts can reach the first document late, so a first window that
 * missed one is reloaded.** `electron.launch` does hold the application's
 * `ready` until Playwright has connected, but it also releases it before it
 * returns: Playwright 1.63.0's launcher calls `__playwright_run()` in the main
 * process from `ElectronApplication.initialize()`, inside the launch (E03-M01's
 * review round 07 read it, and this lane read it again in
 * `node_modules/playwright-core/lib/coreBundle.js`). `src/app/main.ts` opens the
 * window from `whenReady`, so the window can be loading while the five
 * `addInitScript` calls below are still on their way, and a script that arrives
 * after the document was created runs only in the next one. E03-M01-FIX-05 saw
 * a first window with four. Every script is in place once its call has
 * resolved, so the document of a reload after the last one holds all five,
 * whatever the order of events before. The reload is only made when one is
 * missing, because a reload delays the first painted state a start case times;
 * `budgets-start.spec.ts` times no launch that {@link Budgeted.reloaded}.
 *
 * Every init script records whether the renderer's view already existed when it
 * ran; this reads that in the document that has the view, after the reload if
 * there was one, and a launch where any is missing or late is failed here, the
 * application closed and its directory removed, rather than measured.
 *
 * **The user-data directory is made for the launch and removed by
 * {@link closeBudgeted}** (E04-M01-S05), so that a choice the application
 * keeps, a colour scheme or a branch selection, is never read from another
 * suite's run or from the person's own profile, and nothing is left behind.
 */
export async function launchBudgeted(options: LaunchOptions = {}): Promise<Budgeted> {
  const home = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-budgets-'));
  const args = [
    '.',
    ...(options.open === undefined ? [] : [options.open]),
    `--user-data-dir=${home}`,
    ...(options.switches ?? []),
  ];
  const launchedAt = Date.now();
  let application: ElectronApplication;
  try {
    application = await electron.launch({
      args,
      cwd: repositoryRoot,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
  } catch (error) {
    removeHome(home);
    throw error;
  }
  const launched = application.process();
  try {
    const context = application.context();
    for (const script of INIT_SCRIPTS) {
      await context.addInitScript(script);
    }
    const page = await application.firstWindow();
    const first = await installedInView(page);
    const reloaded = !allBeforeRenderer(first);
    if (reloaded) {
      process.stdout.write(
        `    the first document holds init scripts ${JSON.stringify(first)}: reloaded\n`,
      );
      await page.reload();
    }
    const installed = reloaded ? await installedInView(page) : first;
    // Five, written out: a script dropped from the list must fail here, not shrink the check.
    expect(installed).toEqual([true, true, true, true, true]);
    return { application, page, launchedAt, launched, home, reloaded };
  } catch (error) {
    await application.close().catch(() => undefined);
    removeHome(home);
    throw error;
  }
}

/** Whether every init script ran, and ran before the renderer. */
function allBeforeRenderer(installed: readonly boolean[] | null): boolean {
  return installed?.length === INIT_SCRIPTS.length && installed.every((before) => before);
}

/**
 * Remove a launch's user-data directory. Retried, because on Windows a file an
 * exited process held can stay locked for a moment.
 */
function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/**
 * Close the application, unless it has already ended by itself, require the
 * process Playwright started to have exited, and remove the launch's user-data
 * directory.
 */
export async function closeBudgeted(budgeted: Budgeted): Promise<void> {
  const child = budgeted.launched;
  try {
    if (child.exitCode === null) {
      await budgeted.application.close();
    }
    expect(child.exitCode === null && !child.killed).toBe(false);
  } finally {
    removeHome(budgeted.home);
  }
}

/** Run `body` against a launched application, and close it whatever happens. */
export async function withBudgeted(
  options: LaunchOptions,
  body: (budgeted: Budgeted) => Promise<void>,
): Promise<void> {
  const budgeted = await launchBudgeted(options);
  try {
    await body(budgeted);
  } finally {
    await closeBudgeted(budgeted);
  }
}

/**
 * The first mark taken at or after `after` whose state `wanted` accepts, waiting
 * up to `timeout` milliseconds for one.
 */
export async function paintedState(
  page: Page,
  wanted: (state: PaintState) => boolean,
  after = 0,
  timeout = 60_000,
): Promise<PaintMark> {
  const until = Date.now() + timeout;
  for (;;) {
    const found = (await page.evaluate(readProbe)).marks.find(
      (mark) => mark.changedAt >= after && wanted(mark.state),
    );
    if (found !== undefined) {
      return found;
    }
    if (Date.now() > until) {
      throw new Error('no painted frame showed the state waited for');
    }
    await page.waitForTimeout(50);
  }
}

/** One process of the application, as the operating system reports it. */
export interface ProcessReading {
  readonly pid: number;
  readonly parent: number;
  readonly name: string;
  /** Resident memory: the working set, in bytes. */
  readonly workingSet: number;
  /** Memory committed to this process alone, in bytes. */
  readonly privateBytes: number;
  /** Processor time used since the process started, kernel and user, in milliseconds. */
  readonly cpuMilliseconds: number;
  /** When the process was created, in milliseconds since the epoch. */
  readonly createdAt: number;
}

interface CimProcess {
  readonly ProcessId: number;
  readonly ParentProcessId: number;
  readonly Name: string;
  readonly WorkingSetSize: number;
  readonly PrivatePageCount: number;
  readonly KernelModeTime: number;
  readonly UserModeTime: number;
  readonly CreationDate: string;
}

const PROCESS_QUERY =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,' +
  'WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,CreationDate | ' +
  'ConvertTo-Json -Compress';

/**
 * Every process on the machine, read from the operating system's own process
 * table rather than from anything the application reports about itself.
 *
 * Windows only, because it asks Windows Management Instrumentation; the two
 * jobs that run these suites, `e2e` and `budgets`, run on Windows alone
 * (`.github/workflows/ci.yml`), and on another platform this throws rather than
 * reading nothing.
 */
function everyProcess(): readonly ProcessReading[] {
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  return (JSON.parse(output) as CimProcess[]).map((each): ProcessReading => ({
    pid: each.ProcessId,
    parent: each.ParentProcessId,
    name: each.Name,
    workingSet: each.WorkingSetSize,
    privateBytes: each.PrivatePageCount,
    cpuMilliseconds: (each.KernelModeTime + each.UserModeTime) / 10_000,
    createdAt: Number(/\d+/.exec(each.CreationDate)?.[0] ?? Number.NaN),
  }));
}

/**
 * The processes of `readings` that are still running now: the same identifier
 * **and** the same creation time, so that an identifier the system has since
 * given to another program is not mistaken for the one that exited.
 */
export function stillRunning(readings: readonly ProcessReading[]): readonly ProcessReading[] {
  const now = everyProcess();
  return now.filter((each) =>
    readings.some((old) => old.pid === each.pid && old.createdAt === each.createdAt),
  );
}

/** Every process descended from `root`, `root` included. */
export function processTree(root: number): readonly ProcessReading[] {
  const all = everyProcess();
  const tree = all.filter((each) => each.pid === root);
  for (let grew = true; grew;) {
    const known = new Set(tree.map((each) => each.pid));
    const children = all.filter((each) => known.has(each.parent) && !known.has(each.pid));
    tree.push(...children);
    grew = children.length > 0;
  }
  return tree;
}

/** The sum of one field over a set of processes. */
export function total(
  readings: readonly ProcessReading[],
  field: 'workingSet' | 'privateBytes' | 'cpuMilliseconds',
): number {
  return readings.reduce((sum, each) => sum + each[field], 0);
}

/** The middle of an odd number of readings, or the upper middle of an even one. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Readings as a line of text: every value, then the range. */
export function described(values: readonly number[], digits = 0): string {
  const shown = values.map((value) => value.toFixed(digits));
  const low = Math.min(...values).toFixed(digits);
  const high = Math.max(...values).toFixed(digits);
  return `${shown.join(', ')} (range ${low} to ${high})`;
}

/**
 * Hold `measured` to the entry `key` of `perf/baselines.json`, under the regime
 * this run is in, and print the verdict. **Every end-to-end budget reaches the
 * ratchet through the `compareInRegime` call in this function.**
 *
 * With `discarded` set the comparison is made and printed as `DISCARDED` in place
 * of `FAIL` or `ok`, because the reading it comes from does not count either way
 * (`budgets-frames.spec.ts`, its reference bound); the caller does not assert it.
 */
export function holdToBaseline(
  key: string,
  name: string,
  measured: number,
  discarded = false,
): Comparison {
  const baseline = baselines[key];
  if (baseline === undefined) {
    throw new Error(`perf/baselines.json has no entry named ${key}`);
  }
  const comparison = compareInRegime(name, measured, baseline);
  const verdict = discarded ? 'DISCARDED' : comparison.failed ? 'FAIL' : 'ok  ';
  process.stdout.write(`  ${verdict} ${comparison.message}\n`);
  return comparison;
}
