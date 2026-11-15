import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { fixture, withOwnProfile } from './support/fixtures';

/**
 * What the changed-files pane costs when a commit changes many files
 * (E04-M01-S10, scope B12): the live row elements stay within the pool's bound
 * whatever the count, a burst of scroll events costs one redraw, an idle window
 * with the pane full schedules no frame, and the time from handing a reply to the
 * pane drawn is printed, five times for each count, as S09's click timing is.
 *
 * The replies are fed to a second view mounted over the stage, the way
 * `details-panel.spec.ts` feeds one by hand: the view asks for a row's details
 * through `onDetails` and is handed whatever reply the case builds, so a reply of
 * fifty thousand files needs no repository of that size. The pane's constants are
 * written here as literals on purpose, 22 pixels a row and 4 rows of overscan
 * (`FILE_ROW_HEIGHT` and `FILE_OVERSCAN` of `src/ui/`): this file runs in a Node
 * project with no DOM types, and a literal is a ratchet, which a change to the
 * pane's pool must move here, in the diff a reviewer reads.
 *
 * It adds no budget: `docs/ADR-0002-architecture-and-performance.md` decision 6
 * names none for the pane.
 */

const [ROW_PX, OVERSCAN] = [22, 4];
const COUNTS = [1000, 10_000, 50_000];
const SHAPES = ['nested', 'flat'] as const;
const RUNS = 5;

interface Hooks {
  asked: ((reply: unknown) => void)[];
  frames: { registered: number; fired: number };
}

type Shape = (typeof SHAPES)[number];

/** Mount the second view over the stage, fed the open repository's page, and count frames. */
async function prepare(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const scope = globalThis as unknown as {
      document: { querySelector: (at: string) => unknown };
      gitGraphical: { refresh: (request: object) => Promise<{ value: unknown }> };
      gitGraphicalView: {
        mount: (root: unknown) => {
          showPage: (page: unknown) => void;
          onDetails: (l: (target: unknown, answer: (reply: unknown) => void) => void) => void;
        };
      };
      hooks: Hooks;
      requestAnimationFrame: (call: (at: number) => void) => number;
    };
    const view = scope.gitGraphicalView.mount(scope.document.querySelector('.stage'));
    view.showPage((await scope.gitGraphical.refresh({})).value);
    scope.hooks = { asked: [], frames: { registered: 0, fired: 0 } };
    view.onDetails((_target, answer) => scope.hooks.asked.push(answer));
    const original = scope.requestAnimationFrame.bind(scope);
    scope.requestAnimationFrame = (call): number => {
      scope.hooks.frames.registered += 1;
      return original((at) => {
        scope.hooks.frames.fired += 1;
        call(at);
      });
    };
  });
}

/**
 * Hand the `nth` request of the second view a reply of `count` files in `shape`,
 * and say how long it took until the pane was drawn: the reply handed, then two
 * frames.
 */
function answerWith(page: Page, nth: number, count: number, shape: Shape): Promise<number> {
  return page.evaluate(
    async ([at, total, kind]) => {
      const scope = globalThis as unknown as {
        hooks: Hooks;
        performance: { now: () => number };
        requestAnimationFrame: (call: () => void) => number;
      };
      const frame = (): Promise<void> =>
        new Promise((done) => {
          scope.requestAnimationFrame(done);
        });
      const files = Array.from({ length: total }, (_, index) => ({
        path:
          kind === 'flat'
            ? `file-${String(index)}.txt`
            : `d${String(index % 50)}/s${String(index % 20)}/f${String(index)}.txt`,
        oldPath: null,
        status: 'modified',
        additions: 1,
        deletions: 0,
      }));
      const person = { name: 'A', email: 'a@x.invalid', time: 1, offsetMinutes: 0 };
      const reply = {
        ok: true,
        value: {
          hash: 'c'.repeat(40),
          parents: [],
          author: person,
          committer: person,
          message: 'm',
          files,
        },
      };
      const started = scope.performance.now();
      scope.hooks.asked[at]?.(reply);
      await frame();
      await frame();
      return scope.performance.now() - started;
    },
    [nth, count, shape] as const,
  );
}

/** What the pane holds now: every row element, the visible ones' tops, the scroll range. */
function paneOf(
  page: Page,
): Promise<{ elements: number; tops: number[]; room: number; height: number }> {
  return page.evaluate(() => {
    const scope = globalThis as unknown as {
      document: {
        querySelectorAll: (at: string) => Iterable<unknown>;
        querySelector: (at: string) => unknown;
      };
    };
    // Positions are read from the layout, not from the `transform` string: Chromium
    // writes a number past six digits back with six significant ones (1.10328e+06px).
    type Row = { hidden: boolean; getBoundingClientRect: () => { top: number } };
    type Box = { clientHeight: number; getBoundingClientRect: () => { top: number } };
    const rows = [...scope.document.querySelectorAll('.files__row')] as Row[];
    const spacer = scope.document.querySelector('.files__spacer') as Box;
    const scroll = scope.document.querySelector('.files__scroll') as Box;
    const origin = spacer.getBoundingClientRect().top;
    const tops = rows
      .filter((row) => !row.hidden)
      .map((row) => Math.round(row.getBoundingClientRect().top - origin));
    return { elements: rows.length, tops, room: spacer.clientHeight, height: scroll.clientHeight };
  });
}

const frames = (page: Page): Promise<{ registered: number; fired: number }> =>
  page.evaluate(() => (globalThis as unknown as { hooks: Hooks }).hooks.frames);

/** Scroll the pane to `offset`, announcing each step, in one task. */
function burst(page: Page, offsets: number[]): Promise<void> {
  return page.evaluate((steps) => {
    const scope = globalThis as unknown as {
      Event: new (type: string) => unknown;
      document: {
        querySelector: (at: string) => { scrollTop: number; dispatchEvent: (e: unknown) => void };
      };
    };
    const pane = scope.document.querySelector('.files__scroll');
    for (const step of steps) {
      pane.scrollTop = step;
      pane.dispatchEvent(new scope.Event('scroll'));
    }
  }, offsets);
}

/** Open the second view's first row, so that it asks for details. */
async function openRow(page: Page): Promise<void> {
  await page.locator('.row', { hasText: 'merge the side' }).locator('.row__subject').click();
}

test('the pane keeps one pool of rows, however many files a commit changed', async () => {
  test.setTimeout(480_000);
  await withOwnProfile({ open: fixture('details', 'script', 6) }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await prepare(page);
    let asked = 0;
    for (const shape of SHAPES) {
      for (const count of COUNTS) {
        const times: string[] = [];
        for (let run = 0; run < RUNS; run += 1) {
          await openRow(page);
          times.push((await answerWith(page, asked, count, shape)).toFixed(0));
          asked += 1;
          if (run < RUNS - 1) await page.locator('.details__close').click();
        }
        process.stdout.write(`  ${shape} ${String(count)} files: ${times.join(', ')} ms\n`);
        const bound = Math.ceil((await paneOf(page)).height / ROW_PX) + 2 * OVERSCAN;
        for (const offset of [0, ROW_PX * 5, ROW_PX * Math.floor(count / 2), 1e9]) {
          await burst(page, [offset]);
          await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
          const pane = await paneOf(page);
          expect(
            pane.elements,
            `${shape} ${String(count)} at ${String(offset)}`,
          ).toBeLessThanOrEqual(bound);
          expect(pane.elements).toBeGreaterThan(0);
        }
        const end = await paneOf(page);
        expect(Math.max(...end.tops) + ROW_PX).toBe(end.room);
        await page.locator('.details__close').click();
      }
    }
  });
});

test('a burst of scroll events on a full pane costs one redraw, and an idle window schedules no frame', async () => {
  test.setTimeout(240_000);
  await withOwnProfile({ open: fixture('details', 'script', 6) }, async (application) => {
    const page = await application.firstWindow();
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await prepare(page);
    await openRow(page);
    await answerWith(page, 0, 10_000, 'flat');
    await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
    const before = await frames(page);
    await burst(
      page,
      Array.from({ length: 25 }, (_, step) => 40_000 + step * 53),
    );
    await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
    const after = await frames(page);
    process.stdout.write(
      `  burst of 25 scroll events: ${String(after.registered - before.registered)} frames, ${String(after.fired - before.fired)} run\n`,
    );
    expect(after.registered - before.registered).toBe(1);
    expect(after.fired - before.fired).toBe(1);
    await page.waitForTimeout(2000);
    expect(await frames(page)).toEqual(after);
  });
});
