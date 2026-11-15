import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { UNCOMMITTED_COLOUR } from '../../src/contracts/index';
import { laneCentreX, ROW_HEIGHT, rowPoolSize } from '../../src/ui/geometry';
import { laneColour } from '../../src/ui/palette';

import { withBudgeted } from './support/budgets';
import {
  countRowElements,
  loadMoreAndShow,
  readCanvas,
  readProbe,
  scrollListTo,
  viewportHeight,
  wakeupsSettled,
} from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * The details area's height and divider dragged, and where it opens
 * (E04-M01-S12, scopes B and C): the rows and the lines follow the height in
 * force, a drag stops at its limits and costs one redraw a frame, and the area
 * docked at the bottom leaves the graph the closed graph.
 *
 * Every reading is compared with a literal computed here from the rows' heights,
 * never with the code under test. The limits are the orchestrator's choices of the
 * slice document, `docs/plan/E04-commit-details-comparison-and-diff/M01-commit-details-view/S12-panel-size-place-and-options.md`.
 * What Auto Center does and what is kept across a restart are the next two files'.
 */

test.describe.configure({ timeout: 240_000 });

const MOVE = 'move main on';
const [AREA, EDGE, DIVIDER, INFO, FILES] = [
  '.details:not([hidden])',
  '.details__edge',
  '.details__divider',
  '.details__info',
  '.details__files',
];
const FIXTURE = (): string => fixture('details', 'script', 6);

const painted = (page: Page): Promise<number> => page.evaluate(wakeupsSettled, 20_000);

async function box(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = await page.locator(selector).boundingBox();
  if (found === null) throw new Error(`${selector} has no box`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

/** Press the middle of `selector`, move by `dx`, `dy` in eight steps, release, and wait for the frames. */
async function drag(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const at = await box(page, selector);
  const [x, y] = [at.x + at.w / 2, at.y + at.h / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await painted(page);
}

/** Click the row whose subject holds `text`, and wait for the frame that draws its area. */
async function openRow(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await expect(page.locator('.row--open')).toContainText(text);
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
  await painted(page);
}

/** The top of every row shown, by its subject. */
async function tops(page: Page): Promise<Record<string, number>> {
  await expect(page.locator('.row:not([hidden])').first()).toBeVisible();
  const found: Record<string, number> = {};
  for (const row of await page.locator('.row:not([hidden])').all()) {
    found[(await row.locator('.row__subject').textContent()) ?? ''] =
      (await row.boundingBox())?.y ?? -1;
  }
  return found;
}

/** The pixel of the canvas at a CSS point, as RGBA. */
async function canvasOf(page: Page): Promise<(x: number, y: number) => number[]> {
  const canvas = await page.evaluate(readCanvas);
  const bytes = Buffer.from(canvas.rgba, 'base64');
  const ratio = canvas.width / ((await page.locator('.graph__canvas').boundingBox())?.width ?? 1);
  return (x, y) => {
    const at = (Math.floor(y * ratio) * canvas.width + Math.floor(x * ratio)) * 4;
    return [...bytes.subarray(at, at + 4)];
  };
}

/** Whether the pixel is `colour`, inked: each channel within two, alpha over half. */
function isColour(pixel: readonly number[], colour: string): boolean {
  const wanted = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16));
  return (
    wanted.every((channel, at) => Math.abs(channel - (pixel[at] ?? 0)) <= 2) &&
    (pixel[3] ?? 0) > 128
  );
}

/** What the page-side functions below reach, typed without the DOM library. */
interface Scope {
  document: {
    querySelector: (at: string) => {
      getBoundingClientRect: () => { top: number };
      dispatchEvent: (event: object) => void;
    } | null;
  };
  PointerEvent: new (type: string, init: object) => object;
}

/** Runs in the page: fifty pointer moves on the bottom edge, all in one task. */
function fiftyMoves(): void {
  const scope = globalThis as unknown as Scope;
  const handle = scope.document.querySelector('.details__edge');
  const start = handle?.getBoundingClientRect().top ?? 0;
  for (let move = 1; move <= 50; move += 1) {
    handle?.dispatchEvent(
      new scope.PointerEvent('pointermove', { clientX: 400, clientY: start + move, bubbles: true }),
    );
  }
}

test('inline: the bottom edge sets the height, the rows follow, and it stops at its limits', async () => {
  await withBudgeted({ open: FIXTURE() }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await openRow(page, MOVE);
    const before = await tops(page);
    const clicked = before[MOVE] ?? 0;
    await drag(page, EDGE, 0, 100);
    expect((await box(page, AREA)).h).toBe(350);
    const after = await tops(page);
    for (const [subject, top] of Object.entries(before)) {
      expect(after[subject], subject).toBe(top + (top > clicked ? 100 : 0));
    }
    const list = await page.evaluate(viewportHeight);
    await drag(page, EDGE, 0, -3000);
    expect((await box(page, AREA)).h).toBe(120);
    await drag(page, EDGE, 0, 3000);
    expect((await box(page, AREA)).h).toBe(list - ROW_HEIGHT);
  });
});

test('inline: the lines through the area keep running to its new foot', async () => {
  await withBudgeted({ open: FIXTURE() }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await openRow(page, 'Uncommitted changes');
    await drag(page, EDGE, 0, 100);
    const pixel = await canvasOf(page);
    // The uncommitted row's grey line, in lane 0, is drawn to 6 pixels above the area's foot at 350.
    const foot = ROW_HEIGHT + 350;
    expect(isColour(pixel(laneCentreX(0), foot - 6), laneColour(UNCOMMITTED_COLOUR))).toBe(true);
    expect(isColour(pixel(laneCentreX(0), ROW_HEIGHT + 20), laneColour(UNCOMMITTED_COLOUR))).toBe(
      true,
    );
  });
});

test('the divider sets the two panes, within a fifth of the two', async () => {
  await withBudgeted({ open: FIXTURE() }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await openRow(page, MOVE);
    const widths = async (): Promise<[number, number]> => {
      const [info, files] = [await box(page, INFO), await box(page, FILES)];
      return [info.w, files.x + files.w - info.x];
    };
    const total = (await widths())[1];
    await drag(page, DIVIDER, -(total / 4), 0);
    let [left, both] = await widths();
    expect(Math.abs(left - both / 4)).toBeLessThanOrEqual(1);
    await drag(page, DIVIDER, -3000, 0);
    [left, both] = await widths();
    expect(Math.abs(left - both / 5)).toBeLessThanOrEqual(1);
    await drag(page, DIVIDER, 3000, 0);
    [left, both] = await widths();
    expect(Math.abs(left - (both * 4) / 5)).toBeLessThanOrEqual(1);
  });
});

test('a press and release on a handle changes and writes nothing; a drag writes once, at the release', async () => {
  await withBudgeted({ open: FIXTURE() }, async ({ page, home }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await openRow(page, MOVE);
    await page.evaluate(scrollListTo, 30);
    const before = await tops(page);
    const records = join(home, 'details-layouts');
    for (const handle of [EDGE, DIVIDER]) {
      await drag(page, handle, 0, 0);
    }
    await expect(page.locator(AREA)).toBeVisible();
    expect(await tops(page)).toEqual(before);
    expect(existsSync(records)).toBe(false);
    // Fifty moves held back: nothing is on the disk until the release.
    const at = await box(page, EDGE);
    await page.mouse.move(at.x + at.w / 2, at.y + at.h / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.w / 2, at.y + at.h / 2 + 80, { steps: 50 });
    await painted(page);
    expect(existsSync(records)).toBe(false);
    await page.mouse.up();
    await expect.poll(() => (existsSync(records) ? readdirSync(records).length : 0)).toBe(1);
  });
});

test('a burst of moves in one task costs one redraw, and a settled window runs no timer', async () => {
  await withBudgeted({ open: FIXTURE() }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await openRow(page, MOVE);
    const at = await box(page, EDGE);
    await page.mouse.move(at.x + at.w / 2, at.y + at.h / 2);
    await page.mouse.down();
    const before = (await page.evaluate(readProbe)).redraws;
    await page.evaluate(fiftyMoves);
    await painted(page);
    expect((await page.evaluate(readProbe)).redraws - before).toBe(1);
    await page.mouse.up();
    await painted(page);
    const settled = (await page.evaluate(readProbe)).registered;
    await page.waitForTimeout(400);
    expect((await page.evaluate(readProbe)).registered).toEqual(settled);
  });
});

test('the pool of rows holds its size at the least and the greatest height', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(loadMoreAndShow, 9700);
    await page.evaluate(scrollListTo, 5000 * ROW_HEIGHT);
    await page.locator('.row:not([hidden])').nth(8).locator('.row__subject').click();
    await expect(page.locator(AREA)).toBeVisible();
    const pool = rowPoolSize(await page.evaluate(viewportHeight));
    for (const dy of [-3000, 3000]) {
      await drag(page, EDGE, 0, dy);
      expect(await page.evaluate(countRowElements)).toBeLessThanOrEqual(pool);
    }
  });
});

/** What {@link dragFrames} reaches. */
interface FrameScope {
  document: {
    querySelector: (at: string) => {
      getBoundingClientRect: () => { top: number };
      dispatchEvent: (event: object) => void;
    } | null;
  };
  PointerEvent: new (type: string, init: object) => object;
  MessageChannel: new () => {
    port1: { onmessage: (() => void) | null };
    port2: { postMessage: (value: number) => void };
  };
  requestAnimationFrame: (callback: () => void) => number;
  performance: { now: () => number };
}

/**
 * Runs in the page: `frames` pointer moves on the bottom edge, one in each frame, `step` pixels
 * further each, and the time from the move to the first task after the frame that drew it.
 */
async function dragFrames(shape: { frames: number; step: number }): Promise<number[]> {
  const scope = globalThis as unknown as FrameScope;
  const handle = scope.document.querySelector('.details__edge');
  const start = handle?.getBoundingClientRect().top ?? 0;
  const times: number[] = [];
  const channel = new scope.MessageChannel();
  for (let frame = 1; frame <= shape.frames; frame += 1) {
    await new Promise<void>((done) => {
      scope.requestAnimationFrame(() => {
        const began = scope.performance.now();
        const clientY = start + frame * shape.step;
        handle?.dispatchEvent(
          new scope.PointerEvent('pointermove', { clientX: 400, clientY, bubbles: true }),
        );
        channel.port1.onmessage = (): void => {
          times.push(scope.performance.now() - began);
          done();
        };
        channel.port2.postMessage(0);
      });
    });
  }
  return times;
}

test('a drag of 300 pixels over 60 frames: each frame is printed, inline and docked', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(loadMoreAndShow, 9700);
    await page.evaluate(scrollListTo, 5000 * ROW_HEIGHT);
    await page.locator('.row:not([hidden])').nth(8).locator('.row__subject').click();
    await expect(page.locator(AREA)).toBeVisible();
    await expect(page.locator(INFO)).not.toHaveText('Loading…');
    for (const place of ['inline', 'docked']) {
      if (place === 'docked') {
        // The menu opens under the button, so the button goes to the middle of the window first.
        await page
          .locator(`${AREA} button[title="Options"]`)
          .evaluate((button: { scrollIntoView: (to: object) => void }) => {
            button.scrollIntoView({ block: 'center' });
          });
        await page.locator(`${AREA} button[title="Options"]`).click();
        await page.locator('.files__menu-item', { hasText: 'Docked to Bottom' }).click();
        await painted(page);
      }
      for (let run = 1; run <= 5; run += 1) {
        // The edge of a grown area is below the window's foot: bring it in, to press it.
        await page.locator(EDGE).scrollIntoViewIfNeeded();
        await painted(page);
        const at = await box(page, EDGE);
        await page.mouse.move(at.x + at.w / 2, at.y + at.h / 2);
        await page.mouse.down();
        const step = place === 'inline' ? 5 : -5;
        const from = (await box(page, AREA)).h;
        const times = await page.evaluate(dragFrames, { frames: 60, step });
        const to = (await box(page, AREA)).h;
        await page.mouse.up();
        await painted(page);
        const sorted = [...times].sort((a, b) => a - b);
        process.stdout.write(
          `${place} drag ${String(run)}: area ${String(from)} to ${String(to)} px, median ${(sorted[30] ?? 0).toFixed(1)} ms, worst ${(sorted[59] ?? 0).toFixed(1)} ms, frames ${times.map((time) => time.toFixed(1)).join(' ')}\n`,
        );
        expect(times).toHaveLength(60);
        // Back to where it began, so each run drags the same 300 pixels.
        await page.locator(EDGE).scrollIntoViewIfNeeded();
        await painted(page);
        await drag(page, EDGE, 0, place === 'inline' ? -300 : 300);
      }
    }
  });
});
