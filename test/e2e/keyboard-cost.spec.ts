import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { ROW_HEIGHT } from '../../src/ui/geometry';

import { withBudgeted } from './support/budgets';
import { loadMoreAndShow, readProbe, scrollListTo } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * What the keys of the open details cost the window (E04-M01-S11), in the built
 * application.
 *
 * **Counted, and held:** a move is one redraw, as a click on another row is;
 * twenty presses inside one task are one redraw; a key that is not handled, and
 * an idle window with an area open, schedule no frame.
 *
 * **Measured and printed, not held** (`ADR-0002` decision 6 names no budget for a
 * key): the time from a key's dispatch to the area placed under its row, for the
 * longest walk of the rule (Ctrl+Up from the last row of a page of ten thousand)
 * and for Down in the middle of it, five readings each; and a held key.
 * Every reading prints with the processor load sampled (`os.cpus()`, all
 * processors, over the case) beside it.
 */

const SLOW_TEST_MS = 480_000;
const INFO = '.details__info';
const RUNS = 5;

/** Count the calls the main process answers, by channel, from now on. */
async function countCalls(
  application: ElectronApplication,
): Promise<() => Promise<Record<string, number>>> {
  await application.evaluate(({ ipcMain }) => {
    const scope = globalThis as unknown as { asked: Record<string, number> };
    scope.asked = {};
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers;
    for (const [channel, handler] of handlers) {
      handlers.set(channel, (...args: unknown[]) => {
        scope.asked[channel] = (scope.asked[channel] ?? 0) + 1;
        return handler(...args);
      });
    }
  });
  return () =>
    application.evaluate(() => ({
      ...(globalThis as unknown as { asked: Record<string, number> }).asked,
    }));
}

/** Runs in the page: dispatch `count` keydowns of `key` at the document, all in this task. */
function pressIn(input: { key: string; count: number; ctrl: boolean }): void {
  const scope = globalThis as unknown as {
    document: { body: { dispatchEvent: (event: object) => boolean } };
    KeyboardEvent: new (type: string, init: object) => object;
  };
  for (let sent = 0; sent < input.count; sent += 1) {
    scope.document.body.dispatchEvent(
      new scope.KeyboardEvent('keydown', { key: input.key, ctrlKey: input.ctrl, bubbles: true }),
    );
  }
}

/** The top of the open row, in rows, read from its transform. */
async function openRowOf(page: Page): Promise<number> {
  const style = (await page.locator('.row--open').getAttribute('style')) ?? '';
  return Number(/translateY\((\d+)px\)/.exec(style)?.[1] ?? Number.NaN) / ROW_HEIGHT;
}

/** Click layout row `row`, which must be drawn, and wait for its reply. */
async function clickRow(page: Page, row: number): Promise<void> {
  const mine = page.locator(`.row[style*="translateY(${String(row * ROW_HEIGHT)}px)"]`);
  await mine.locator('.row__subject').click();
  await expect(mine).toHaveClass(/row--open/);
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
}

/** Wait until the page has run two frames, so that whatever a key scheduled has been drawn. */
const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const { requestAnimationFrame: frame } = globalThis as unknown as {
      requestAnimationFrame: (call: () => void) => void;
    };
    return new Promise<void>((done) => {
      frame(() => {
        frame(done);
      });
    });
  });

const frames = async (page: Page): Promise<number[]> => {
  const probe = await page.evaluate(readProbe);
  return [
    probe.registered['requestAnimationFrame'] ?? 0,
    probe.registered['setTimeout'] ?? 0,
    probe.redraws,
  ];
};

test('a move is one redraw, twenty presses in a task are one, and unhandled keys schedule nothing', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await clickRow(page, 3);
    const redraws = async (): Promise<number> => {
      await settle(page);
      return (await page.evaluate(readProbe)).redraws;
    };
    const base = await redraws();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => openRowOf(page)).toBe(4);
    await expect(page.locator(INFO)).not.toHaveText('Loading…');
    const moved = await redraws();
    await clickRow(page, 1);
    const clicked = await redraws();
    await page.evaluate(pressIn, { key: 'ArrowDown', count: 20, ctrl: false });
    await expect.poll(() => openRowOf(page)).toBe(21);
    await expect(page.locator(INFO)).not.toHaveText('Loading…');
    const burst = await redraws();
    process.stdout.write(
      `  redraws: a move ${String(moved - base)}, a click ${String(clicked - moved)}, twenty presses ${String(burst - clicked)}\n`,
    );
    expect([moved - base, clicked - moved, burst - clicked]).toEqual([1, 1, 1]);
    const before = await frames(page);
    for (const key of ['Shift+ArrowUp', 'ArrowLeft', 'a', 'Control+ArrowLeft']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(500);
    expect(await frames(page)).toEqual(before);
    expect(await openRowOf(page)).toBe(21);
  });
});

/** The processor load over a stretch, from two `os.cpus()` readings: the share of time not idle. */
function loadBetween(first: ReturnType<typeof cpus>, last: ReturnType<typeof cpus>): string {
  let [busy, total] = [0, 0];
  last.forEach((cpu, at) => {
    const was = first[at]?.times ?? cpu.times;
    const [idle, all] = [
      cpu.times.idle - was.idle,
      Object.values(cpu.times).reduce((a, b) => a + b, 0) -
        Object.values(was).reduce((a, b) => a + b, 0),
    ];
    busy += all - idle;
    total += all;
  });
  return `${(total === 0 ? 0 : (100 * busy) / total).toFixed(0)} %`;
}

/** Runs in the page: dispatch one key at the document and read when the area stands under its row. */
function timedPress(input: { key: string; ctrl: boolean }): { milliseconds: number; open: string } {
  const scope = globalThis as unknown as {
    document: {
      body: { dispatchEvent: (event: object) => boolean };
      querySelector: (at: string) => {
        style: { transform: string };
        getBoundingClientRect: () => object;
      } | null;
    };
    KeyboardEvent: new (type: string, init: object) => object;
    performance: { now: () => number };
  };
  const started = scope.performance.now();
  scope.document.body.dispatchEvent(
    new scope.KeyboardEvent('keydown', { key: input.key, ctrlKey: input.ctrl, bubbles: true }),
  );
  const area = scope.document.querySelector('.details');
  area?.getBoundingClientRect();
  const milliseconds = scope.performance.now() - started;
  return { milliseconds, open: area?.style.transform ?? '' };
}

test('a move on a page of ten thousand rows: the longest walk, and Down in the middle (printed)', async () => {
  test.setTimeout(SLOW_TEST_MS);
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    const { rows } = await page.evaluate(loadMoreAndShow, 9700);
    expect(rows).toBeGreaterThanOrEqual(10_000);
    const first = cpus();
    const readings: Record<string, string[]> = {
      'Ctrl+Up from the last row': [],
      'Down in the middle': [],
    };
    for (let run = 0; run < RUNS; run += 1) {
      for (const [name, row, key, ctrl, under] of [
        ['Ctrl+Up from the last row', rows - 1, 'ArrowUp', true, -1],
        ['Down in the middle', Math.floor(rows / 2), 'ArrowDown', false, 1],
      ] as const) {
        await page.evaluate(scrollListTo, (row - 5) * ROW_HEIGHT);
        await clickRow(page, row);
        const { milliseconds, open } = await page.evaluate(timedPress, { key, ctrl });
        // The open row's class is written by the next frame, so wait for it to leave `row`.
        await expect.poll(() => openRowOf(page), { message: name }).not.toBe(row);
        const moved = await openRowOf(page);
        expect(moved, name).toBeLessThan(under < 0 ? row : rows);
        if (under > 0) expect(moved).toBe(row + 1);
        expect(open, name).toBe(`translateY(${String((moved + 1) * ROW_HEIGHT)}px)`);
        readings[name]?.push(milliseconds.toFixed(1));
        await page.locator('.details__close').click();
      }
    }
    for (const [name, times] of Object.entries(readings)) {
      process.stdout.write(`  ${name}: ${times.join(', ')} ms\n`);
    }
    process.stdout.write(`  processor load over the case: ${loadBetween(first, cpus())}\n`);
  });
});

/** Runs in the page: record every change of the details' first line, with the time it was drawn. */
function watchInfo(): void {
  const scope = globalThis as unknown as {
    drawn: [number, string][];
    MutationObserver: new (call: () => void) => { observe: (at: object, init: object) => void };
    document: { querySelector: (at: string) => { innerText: string } | null };
    performance: { now: () => number };
  };
  scope.drawn = [];
  const info = scope.document.querySelector('.details__info');
  new scope.MutationObserver(() => {
    scope.drawn.push([scope.performance.now(), (info?.innerText ?? '').split('\n')[0] ?? '']);
  }).observe(info ?? {}, { childList: true, subtree: true, characterData: true });
}

/** Runs in the page: press `count` times, each press in a task of its own, and say when the first was. */
async function hold(count: number): Promise<number> {
  const scope = globalThis as unknown as {
    document: { body: { dispatchEvent: (event: object) => boolean } };
    KeyboardEvent: new (type: string, init: object) => object;
    MessageChannel: new () => {
      port1: { onmessage: (() => void) | null };
      port2: { postMessage: (value: number) => void };
    };
    performance: { now: () => number };
  };
  const channel = new scope.MessageChannel();
  const at = scope.performance.now();
  for (let sent = 0; sent < count; sent += 1) {
    scope.document.body.dispatchEvent(
      new scope.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    await new Promise<void>((done) => {
      channel.port1.onmessage = (): void => {
        done();
      };
      channel.port2.postMessage(0);
    });
  }
  return at;
}

/** The git processes the trace file has seen start so far. */
const startedIn = (trace: string): number =>
  readFileSync(trace, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"event":"start"')).length;

test('a held key: twenty presses ask for twenty reads and draw the last one (printed)', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const trace = join(mkdtempSync(join(tmpdir(), 'git-graphical-standalone-trace-')), 'trace.json');
  writeFileSync(trace, '');
  const env = { ...process.env, GIT_TRACE2_EVENT: trace } as Record<string, string>;
  const options = { open: fixture('large', 'large', 10_000), env };
  await withBudgeted(options, async ({ application, page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    const calls = await countCalls(application);
    await clickRow(page, 3);
    await page.waitForTimeout(500);
    const [asked, processes] = [
      (await calls())['repository:commit-details'] ?? 0,
      startedIn(trace),
    ];
    await page.evaluate(watchInfo);
    const started = await page.evaluate(hold, 20);
    await expect.poll(() => openRowOf(page)).toBe(23);
    await expect(page.locator(INFO)).not.toHaveText('Loading…');
    await page.waitForTimeout(1500);
    const drawn = await page.evaluate(
      () => (globalThis as unknown as { drawn: [number, string][] }).drawn,
    );
    const sent = ((await calls())['repository:commit-details'] ?? 0) - asked;
    const shown = drawn.filter(([, line]) => line.startsWith('Commit: '));
    const [lastAt = 0, last = ''] = shown.at(-1) ?? [];
    process.stdout.write(
      `  held key: 20 presses, ${String(sent)} reads asked, ${String(startedIn(trace) - processes)} git processes started, ` +
        `${String(new Set(shown.map(([, line]) => line)).size)} distinct replies drawn, the last ${(lastAt - started).toFixed(0)} ms after the first press
`,
    );
    expect(sent).toBe(20);
    expect(shown.filter(([, line]) => line === last).length).toBeGreaterThan(0);
    await page.locator('.details__close').click();
    await clickRow(page, 23);
    expect((await page.locator(INFO).innerText()).split('\n')[0]).toBe(last);
  });
});
