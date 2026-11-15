import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { UNCOMMITTED_COLOUR } from '../../src/contracts/index';
import { laneCentreX, ROW_HEIGHT } from '../../src/ui/geometry';
import { laneColour } from '../../src/ui/palette';

import { paintedState, withBudgeted } from './support/budgets';
import { readCanvas } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * The stash rows and the uncommitted row's line in the built application
 * (E04-M01-S14), on the `stashes` fixture: the shape the reference extension
 * was observed with, `stash@{0}` on `main`'s tip with an untracked file,
 * `stash@{1}` on a commit no branch reaches, and an uncommitted change.
 *
 * What the layout decides is held without a window by `src/adapters/git-stash.spec.ts`
 * and `test/e2e/graph-geometry.spec.ts`. This holds what only the window shows:
 * the two-part label and the message after it, and, read back from the canvas,
 * that the inside of each ring is cleared, that a stash's ring holds its small
 * disc, and that the uncommitted row's line is grey past the stash and into
 * HEAD's row. The canvas is drawn in software (`--disable-gpu`), as the golden
 * image is, and the points read are chosen from a reading of this canvas at
 * device pixel ratio 1, recorded in the slice document.
 */

/** `#rrggbb` as its three channels. */
function rgbOf(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

/**
 * How far a pixel's colour is from `hex`: the largest difference of one
 * channel. An anti-aliased pixel is stored premultiplied and read back
 * unpremultiplied, which moved a channel by one in this lane's reading.
 */
function distance(pixel: readonly number[], hex: string): number {
  return Math.max(...rgbOf(hex).map((channel, at) => Math.abs(channel - (pixel[at] ?? 0))));
}

/** The row element drawn at the top of row `row`. */
function rowElement(page: Page, row: number): ReturnType<Page['locator']> {
  return page.locator(`.row[style*="translateY(${String(row * ROW_HEIGHT)}px)"]`);
}

/** The canvas read back, and a reader of the RGBA at a CSS point of it. */
async function canvasOf(page: Page): Promise<(x: number, y: number) => number[]> {
  const canvas = await page.evaluate(readCanvas);
  const bytes = Buffer.from(canvas.rgba, 'base64');
  const ratio =
    canvas.width /
    (await page.locator('.graph__canvas').evaluate((node) => {
      const box = (
        node as unknown as { getBoundingClientRect(): { width: number } }
      ).getBoundingClientRect();
      return box.width;
    }));
  return (x, y) => {
    const at = (Math.floor(y * ratio) * canvas.width + Math.floor(x * ratio)) * 4;
    return [...bytes.subarray(at, at + 4)];
  };
}

/** The centre height of a row on the canvas. */
const centreY = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2;

test('a stash row shows its two-part label, its ring, and the grey line beside it', async () => {
  const repository = fixture('stashes', 'script', 3);
  await withBudgeted({ open: repository, switches: ['--disable-gpu'] }, async ({ page }) => {
    await paintedState(
      page,
      (state) => state.path === repository && state.rows === 6 && state.ink > 0,
    );
    const first = rowElement(page, 1);
    await expect(first.locator('.ref--stash .ref__name')).toHaveText('stash@{0}');
    await expect(first.locator('.ref--stash .ref__icon svg path')).toHaveCount(1);
    const [r, g, b] = rgbOf(laneColour(1));
    await expect(first.locator('.ref__icon')).toHaveCSS(
      'background-color',
      `rgb(${String(r)}, ${String(g)}, ${String(b)})`,
    );
    await expect(first.locator('.row__subject')).toHaveText(
      'On main: stash with an untracked file',
    );
    const third = rowElement(page, 3);
    await expect(third.locator('.ref__name')).toHaveText('stash@{1}');
    await expect(third.locator('.row__subject')).toHaveText('On gone: stash on a deleted branch');
    await expect(rowElement(page, 2).locator('.ref--stash')).toHaveCount(0);

    const inked = await canvasOf(page);
    const lane0 = laneCentreX(0);
    const lane1 = laneCentreX(1);
    // Inside each ring, clear: the uncommitted ring's centre, and a stash ring's
    // between its disc and its rim, where its own line would otherwise run.
    expect(inked(lane0, centreY(0))[3]).toBe(0);
    expect(inked(lane1 - 1.5, centreY(1) - 1.5)[3]).toBe(0);
    // A stash's disc at its centre, in its lane's colour. Its line leaves the ring
    // already bending towards HEAD's lane, which `graph-geometry.spec.ts` holds.
    for (const y of [centreY(1)]) {
      expect(distance(inked(lane1, y), laneColour(1)), `y ${String(y)}`).toBeLessThanOrEqual(2);
      expect(inked(lane1, y)[3] ?? 0).toBeGreaterThan(128);
    }
    // The uncommitted row's line: grey below its ring, beside the stash, and in
    // HEAD's row above its dot; HEAD's own line below its dot in its lane's colour.
    const grey = laneColour(UNCOMMITTED_COLOUR);
    const lines: [number, string][] = [
      [centreY(0) + 8, grey],
      [centreY(1), grey],
      [2 * ROW_HEIGHT + 4, grey],
      [centreY(2) + 8, laneColour(0)],
    ];
    for (const [y, colour] of lines) {
      expect(distance(inked(lane0, y), colour), `y ${String(y)}`).toBeLessThanOrEqual(2);
      expect(inked(lane0, y)[3] ?? 0).toBeGreaterThan(128);
    }
    // Nothing above the stash's ring.
    expect(inked(lane1, ROW_HEIGHT + 3)[3]).toBe(0);
  });
});
