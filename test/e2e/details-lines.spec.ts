import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

import { entryAt } from '../../src/contracts/column-read';
import { HASH_BYTE_LENGTH, UNCOMMITTED_COLOUR } from '../../src/contracts/index';
import type { CommitColumns, LayoutRows } from '../../src/contracts/index';
import { createLayoutState, layoutPage } from '../../src/core/layout/index';
import { LOADING_NOTE } from '../../src/ui/details-area';
import {
  DETAILS_HEIGHT,
  GAP_ABOVE,
  GAP_BELOW,
  gapLines,
  laneCentreX,
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  rowTopY,
  segmentLines,
  visibleRowCount,
} from '../../src/ui/geometry';
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
 * The lines across an open details area (E04-M01-S09, scope 4), and what an open
 * area costs the window (scope 8).
 *
 * **Why these are not in `graph-geometry.spec.ts` and `graph-table.spec.ts`.**
 * Those files hold 294 and 290 of the 300 lines `eslint.config.js` allows a
 * module (measured with `max-lines` set to 1, 2026-11-11), so the cases that
 * belong beside them are here, in the way `superseded-reply.spec.ts` came to be.
 * The layouts are made by the real layout pass, and each expected point is cut
 * from an S-curve built here, not taken from the code under test.
 */

const [X0, X1] = [laneCentreX(0), laneCentreX(1)];
const HALF = ROW_HEIGHT / 2;

/** A page built from its parent lists alone, laid out by the real layout pass. */
function laidOut(parents: readonly (readonly number[])[]): LayoutRows {
  const count = parents.length;
  const parentOffsets = new Uint32Array(count + 1);
  parents.forEach(
    (list, row) => (parentOffsets[row + 1] = entryAt(parentOffsets, row) + list.length),
  );
  const columns: CommitColumns = {
    count,
    hashes: new Uint8Array(count * HASH_BYTE_LENGTH),
    parentOffsets,
    parentIndices: Uint32Array.from(parents.flat()),
    authorId: new Uint32Array(count),
    committerId: new Uint32Array(count),
    authorTime: new Float64Array(count),
    commitTime: new Float64Array(count),
    authorTzMinutes: new Int16Array(count),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets: new Uint32Array(count + 1),
    subjects: '',
    people: { names: [], emails: [] },
  };
  return layoutPage(createLayoutState(), columns, 0);
}

/** The segment of `row` that goes from lane `from` to lane `to`. */
function segmentOf(rows: LayoutRows, row: number, from: number, to: number): number {
  const first = entryAt(rows.segmentOffsets, row);
  const last = entryAt(rows.segmentOffsets, row + 1);
  const found = Array.from({ length: last - first }, (_unused, at) => first + at).find(
    (segment) =>
      entryAt(rows.segmentFromLane, segment) === from &&
      entryAt(rows.segmentToLane, segment) === to,
  );
  return found ?? -1;
}

/**
 * The reference's S-curve from `(fromLane, ya)` to `(toLane, ya + ROW_HEIGHT)`,
 * vertical at both ends with its middle on the boundary, cut at its middle by
 * de Casteljau into its first and second half, each as start, two control points
 * and end.
 */
function cutS(ya: number, fromLane: number, toLane: number): [number[], number[]] {
  const [xa, xb, boundary] = [laneCentreX(fromLane), laneCentreX(toLane), ya + HALF];
  const mid = (a: number[], b: number[]): number[] => a.map((v, at) => (v + (b[at] ?? 0)) / 2);
  const p = [
    [xa, ya],
    [xa, boundary],
    [xb, boundary],
    [xb, ya + ROW_HEIGHT],
  ];
  const [p0 = [], p1 = [], p2 = [], p3 = []] = p;
  const [p01, p12, p23] = [mid(p0, p1), mid(p1, p2), mid(p2, p3)];
  const [p012, p123] = [mid(p01, p12), mid(p12, p23)];
  const centre = mid(p012, p123);
  return [
    [...p0, ...p01, ...p012, ...centre],
    [...centre, ...p123, ...p23, ...p3],
  ];
}

const into = (): number[] => new Array<number>(14).fill(0);

test("under a merge, the further parent's curve stays one row tall, then runs straight", () => {
  // Row 0 merges row 4, which sits in lane 1; rows 1 to 3 are the first parents.
  const rows = laidOut([[1, 4], [2], [3], [5], [5], []]);
  const [second, out] = [segmentOf(rows, 0, 0, 1), into()];
  const gapTop = rowTopY(0, 0, 0) + ROW_HEIGHT;
  const [firstHalf, secondHalf] = cutS(HALF, 0, 1);
  expect(gapLines(out, rows, 0, second, gapTop)).toBe(2);
  expect(out.slice(0, 8)).toEqual(secondHalf);
  const bottom = gapTop + DETAILS_HEIGHT;
  expect(out.slice(8)).toEqual([X1, bottom, X1, bottom, X1, bottom]);
  // The row's own half is the first half of the same curve, and the row below paints a straight line.
  expect(segmentLines(out, rows, 0, second, 0, GAP_BELOW)).toBe(1);
  expect(out.slice(0, 8)).toEqual(firstHalf);
  const passing = segmentOf(rows, 1, 1, 1);
  const below = rowTopY(1, 0, 0);
  expect(segmentLines(out, rows, 1, passing, below, GAP_ABOVE)).toBe(2);
  expect([0, 2, 4, 6, 8, 10, 12].map((at) => out[at])).toEqual(Array<number>(7).fill(X1));
  segmentLines(out, rows, 1, passing, below);
  expect(out[0]).not.toBe(X1);
});

test('above a parent, a line runs straight through the area, then curves into the dot', () => {
  // Rows 1 to 4 are a branch in lane 1 that forks from row 5; row 0 is in lane 0.
  const rows = laidOut([[5], [2], [3], [4], [5], []]);
  const [branch, out] = [segmentOf(rows, 4, 1, 1), into()];
  const gapTop = rowTopY(4, 0, 4) + ROW_HEIGHT;
  const [dot, below] = [rowTopY(5, 0, 4) + HALF, rowTopY(5, 0, 4)];
  const [firstHalf, secondHalf] = cutS(dot - ROW_HEIGHT, 1, 0);
  expect(gapLines(out, rows, 4, branch, gapTop)).toBe(2);
  expect(out.slice(0, 2)).toEqual([X1, gapTop]);
  expect(out.slice(6, 14)).toEqual(firstHalf);
  expect(out[7]).toBe(gapTop + DETAILS_HEIGHT - HALF);
  // The parent's own half is the second half of that curve, the row's own is straight.
  expect(segmentLines(out, rows, 5, segmentOf(rows, 5, 1, 0), below, GAP_ABOVE)).toBe(1);
  expect(out.slice(0, 8)).toEqual(secondHalf);
  expect(segmentLines(out, rows, 4, branch, rowTopY(4, 0, 4), GAP_BELOW)).toBe(2);
  expect([out[6], out[7], out[12], out[13]]).toEqual([X1, rowTopY(4, 0, 4) + HALF, X1, gapTop]);
});

test('a line in one lane crosses straight; a line that neither joins nor leaves, leaves', () => {
  const rows = laidOut([[1, 3], [2], [3], []]);
  const [gapTop, out] = [rowTopY(1, 0, 1) + ROW_HEIGHT, into()];
  expect(gapLines(out, rows, 1, segmentOf(rows, 1, 1, 1), gapTop)).toBe(2);
  expect(out.filter((_value, at) => at % 2 === 0)).toEqual(Array<number>(7).fill(X1));
  expect([out[1], out[13]]).toEqual([gapTop, gapTop + DETAILS_HEIGHT]);
  // Row 2 is in lane 1 and its second parent, row 3, is laid out in lane 2 but arrives in lane 0.
  const odd = laidOut([[3], [2], [4, 3], [4], []]);
  const top = rowTopY(2, 0, 2) + ROW_HEIGHT;
  expect(gapLines(out, odd, 2, segmentOf(odd, 2, 1, 2), top)).toBe(2);
  expect(out.slice(0, 8)).toEqual(cutS(2 * ROW_HEIGHT + HALF, 1, 0)[1]);
  expect([out[7], out[13]]).toEqual([top + HALF, top + DETAILS_HEIGHT]);
});

/** Wait until the frames a click asked for have been painted. */
const painted = (page: Page): Promise<number> => page.evaluate(wakeupsSettled, 20_000);

/** The canvas read back, as a reader of the RGBA at a CSS point of it. */
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

/** Click the row whose subject holds `text`, and wait for the frame that draws its area. */
async function openRow(page: Page, text: string): Promise<(x: number, y: number) => number[]> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await painted(page);
  return canvasOf(page);
}

/** Both lanes are drawn at each height, and nothing is between them. */
function lanesAt(pixel: (x: number, y: number) => number[], heights: readonly number[]): void {
  for (const y of heights) {
    expect(isColour(pixel(X1, y), laneColour(1)), `lane 1 at ${String(y)}`).toBe(true);
    expect(isColour(pixel(X0, y), laneColour(0)), `lane 0 at ${String(y)}`).toBe(true);
    expect(pixel(19, y)[3], `between at ${String(y)}`).toBe(0);
  }
}

/** The merge's area: its curve stays one row tall, and the row after the area sits under it. */
async function underMerge(page: Page): Promise<void> {
  const pixel = await openRow(page, 'merge the side');
  const foot = 2 * ROW_HEIGHT;
  // The curve leaves the dot, is half-way across at the area's top edge, and ends one row below the dot.
  expect(isColour(pixel(19, foot), laneColour(1))).toBe(true);
  expect(isColour(pixel(X1, foot + HALF), laneColour(1))).toBe(true);
  // The row after the area is its height lower: its dot is there, and not where a closed graph has it.
  expect(isColour(pixel(X0 + 2, foot + DETAILS_HEIGHT + HALF), laneColour(0))).toBe(true);
  expect(pixel(X0 + 2, foot + HALF)[3]).toBe(0);
  lanesAt(pixel, [foot + 60, foot + 150, foot + 240]);
}

/** A window too short to show a band of either row, scrolled into the area: the lines are still drawn. */
async function insideArea(application: ElectronApplication, page: Page): Promise<void> {
  const size = (height: number) => async (): Promise<void> => {
    await application.evaluate(({ BrowserWindow }, tall) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setMinimumSize(0, 0);
      window?.setContentSize(900, tall);
    }, height);
  };
  await size(200)();
  await expect.poll(() => page.evaluate(viewportHeight)).toBeLessThan(200 - ROW_HEIGHT);
  const short = await page.evaluate(viewportHeight);
  await page.evaluate(scrollListTo, 2 * ROW_HEIGHT + 20);
  await painted(page);
  lanesAt(await canvasOf(page), [10, short / 2, short - 10]);
  await size(800)();
  await page.evaluate(scrollListTo, 0);
}

/** The branch tip's area: a line straight down lane 1, then the curve into the parent's dot. */
async function aboveParent(page: Page): Promise<void> {
  const pixel = await openRow(page, 'add a file on the side');
  const [tip, parent] = [4 * ROW_HEIGHT, 4 * ROW_HEIGHT + DETAILS_HEIGHT];
  for (const y of [tip + 20, tip + 120, parent - 14]) {
    expect(isColour(pixel(X1, y), laneColour(1)), `lane 1 at ${String(y)}`).toBe(true);
  }
  expect(isColour(pixel(19, parent), laneColour(1))).toBe(true);
  expect(pixel(19, tip + 120)[3]).toBe(0);
}

test('the built window draws the lines through an open area where the geometry says', async () => {
  const repository = fixture('details', 'script', 6);
  const launch = { open: repository, switches: ['--disable-gpu'] };
  await withBudgeted(launch, async ({ application, page }) => {
    await expect(page.locator('.row', { hasText: 'merge the side' })).toBeVisible({
      timeout: 60_000,
    });
    // Rows: 0 uncommitted, 1 the merge (lane 0, its second parent in lane 1), 2 and 3 its parents, 4 their parent.
    await underMerge(page);
    await insideArea(application, page);
    await aboveParent(page);
    // The uncommitted row's grey line crosses an area opened under its ring.
    const pixel = await openRow(page, 'Uncommitted changes');
    for (const y of [ROW_HEIGHT + 20, ROW_HEIGHT + 130, ROW_HEIGHT + 240]) {
      expect(isColour(pixel(X0, y), laneColour(UNCOMMITTED_COLOUR)), `grey at ${String(y)}`).toBe(
        true,
      );
    }
  });
});

test('the view centres the row and its area, and stops at the end of the list', async () => {
  test.setTimeout(240_000);
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    const loaded = await page.evaluate(loadMoreAndShow, 9700);
    const read = (): Promise<number[]> =>
      page.locator('.graph__scroll').evaluate((each) => {
        const node = each as unknown as {
          scrollTop: number;
          clientHeight: number;
          scrollHeight: number;
        };
        return [node.scrollTop, node.clientHeight, node.scrollHeight];
      });
    const open = async (row: number): Promise<void> => {
      const mine = page.locator(`.row[style*="translateY(${String(row * ROW_HEIGHT)}px)"]`);
      await mine.locator('.row__subject').click();
      await expect(mine).toHaveClass(/row--open/);
    };
    await page.evaluate(scrollListTo, 5000 * ROW_HEIGHT);
    await open(5005);
    const [scroll = 0, shown = 0] = await read();
    const [block, list] = [
      5005 * ROW_HEIGHT + (ROW_HEIGHT + DETAILS_HEIGHT) / 2,
      shown - ROW_HEIGHT,
    ];
    expect(Math.abs(block - (scroll + list / 2))).toBeLessThanOrEqual(1);
    await page.locator('.details__close').click();
    expect((await read())[0]).toBe(scroll);
    await page.evaluate(scrollListTo, 1e9);
    await open(loaded.rows - 3);
    const [end = 0, tall = 0, room = 0] = await read();
    expect(end + tall).toBeGreaterThanOrEqual(room - 1);
  });
});

test('with an area open on a page of ten thousand rows, the window costs what it cost', async () => {
  test.setTimeout(240_000);
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
    expect((await page.evaluate(loadMoreAndShow, 9700)).rows).toBeGreaterThanOrEqual(10_000);
    await page.locator('.row[style*="translateY(0px)"] .row__subject').click();
    // The reply that fills the area asks for a frame when it lands, so it is waited for here.
    await expect(page.locator('.details__info')).not.toHaveText(LOADING_NOTE, { timeout: 60_000 });
    const bound = visibleRowCount(await page.evaluate(viewportHeight)) + 2 * OVERSCAN_ROWS;
    let counts: number[] = [];
    for (const offset of [0, ROW_HEIGHT * 5, 120_000, 239_000]) {
      await page.evaluate(scrollListTo, offset);
      await page.evaluate(wakeupsSettled, 20_000);
      counts = [...counts, await page.evaluate(countRowElements)];
    }
    process.stdout.write(
      `live rows with an area open: ${counts.join(', ')}, bound ${String(bound)}\n`,
    );
    expect(Math.max(...counts)).toBeLessThanOrEqual(bound);
    // A burst of scroll events, each announced, is one redraw; an idle window schedules no frame.
    const before = await page.evaluate(wakeupsSettled, 20_000);
    await page.evaluate(() => {
      const scope = globalThis as unknown as {
        Event: new (type: string) => object;
        document: {
          querySelector: (
            at: string,
          ) => { scrollTop: number; dispatchEvent: (e: object) => boolean } | null;
        };
      };
      const list = scope.document.querySelector('.graph__scroll');
      for (let step = 1; step <= 25; step += 1) {
        if (list !== null) list.scrollTop = 40_000 + step * 53;
        list?.dispatchEvent(new scope.Event('scroll'));
      }
    });
    const after = await page.evaluate(wakeupsSettled, 20_000);
    process.stdout.write(
      `burst of 25 offsets with an area open: ${String(after - before)} redraws\n`,
    );
    expect(after - before).toBeGreaterThan(0);
    expect(after - before).toBeLessThanOrEqual(2);
    const settled = (await page.evaluate(readProbe)).registered;
    await page.waitForTimeout(2000);
    const idle = (await page.evaluate(readProbe)).registered;
    expect(idle).toEqual(settled);
  });
});
