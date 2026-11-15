import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { laneCentreX, ROW_HEIGHT } from '../../src/ui/geometry';

import { withBudgeted } from './support/budgets';
import { readCanvas, scrollListTo, viewportHeight, wakeupsSettled } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * The details area docked at the bottom of the view (E04-M01-S12, scope C): the
 * panel's place and height, a graph that is the closed graph above it, the ways of
 * closing it, the list that still reaches its last row and Load More, and a change
 * of place that asks for nothing again.
 *
 * Every reading is compared with a literal or with the same window's closed
 * graph, never with the code under test.
 */

test.describe.configure({ timeout: 240_000 });

const MERGE = 'merge the side';
const MOVE = 'move main on';
const [AREA, EDGE, INFO] = ['.details:not([hidden])', '.details__edge', '.details__info'];

interface Scope {
  document: {
    querySelector: (at: string) => { textContent: string | null; scrollTop: number } | null;
    querySelectorAll: (at: string) => Iterable<{ style: { transform: string } }>;
  };
  MutationObserver: new (callback: () => void) => {
    observe: (target: object, options: object) => void;
  };
  seenInfo?: string[];
}

/** Runs in the page: write down every text the left pane takes from now on. */
function watchInfo(): void {
  const scope = globalThis as unknown as Scope;
  const seen: string[] = [];
  scope.seenInfo = seen;
  const info = scope.document.querySelector('.details__info');
  new scope.MutationObserver(() => {
    seen.push(info?.textContent ?? '');
  }).observe(info ?? {}, { childList: true, characterData: true, subtree: true });
}

/** Runs in the page: the texts written since {@link watchInfo}. */
function seenInfo(): string[] {
  return (globalThis as unknown as Scope).seenInfo ?? [];
}

/** Runs in the page: where the list is scrolled to. */
function offset(): number {
  return (globalThis as unknown as Scope).document.querySelector('.graph__scroll')?.scrollTop ?? -1;
}

/** Runs in the page: the content offset of every row shown. */
function shownTransforms(): string[] {
  const rows = (globalThis as unknown as Scope).document.querySelectorAll('.row:not([hidden])');
  return [...rows].map((row) => row.style.transform);
}

const painted = (page: Page): Promise<number> => page.evaluate(wakeupsSettled, 20_000);

async function box(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const found = await page.locator(selector).boundingBox();
  if (found === null) throw new Error(`${selector} has no box`);
  return { x: found.x, y: found.y, w: found.width, h: found.height };
}

async function drag(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const at = await box(page, selector);
  const [x, y] = [at.x + at.w / 2, at.y + at.h / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await painted(page);
}

async function openRow(page: Page, text: string): Promise<void> {
  await page.locator('.row', { hasText: text }).locator('.row__subject').click();
  await expect(page.locator('.row--open')).toContainText(text);
  await expect(page.locator(INFO)).not.toHaveText('Loading…');
  await painted(page);
}

/** Choose `value` of the option `title` from the open area's Options menu. */
async function choose(page: Page, title: string, value: string): Promise<void> {
  await page.locator(`${AREA} button[title="Options"]`).click();
  const lines = page.locator('.files__menu > *');
  const texts = (await lines.allTextContents()).map((text) => text.replace('●', ''));
  const heading = texts.indexOf(title);
  await lines.nth(texts.findIndex((text, at) => at > heading && text === value)).click();
  await painted(page);
}

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

const ready = async (page: Page): Promise<void> => {
  await expect(page.locator('.row:not([hidden])').first()).toBeVisible({ timeout: 60_000 });
};

test('docked: a panel at the foot, the rows where they are closed, and the top edge sets its height', async () => {
  await withBudgeted({ open: fixture('details', 'script', 6) }, async ({ page }) => {
    await ready(page);
    await openRow(page, MOVE);
    await choose(page, 'Location', 'Docked to Bottom');
    const [view, panel] = [await box(page, '.graph'), await box(page, AREA)];
    expect([panel.x, panel.w, panel.h]).toEqual([view.x, view.w, 250]);
    expect(Math.abs(panel.y + panel.h - (view.y + view.h))).toBeLessThanOrEqual(1);
    await expect(page.locator('.row--open')).toContainText(MOVE);
    // No row moves: each is at a whole number of rows from the top of the content.
    for (const transform of await page.evaluate(shownTransforms)) {
      const y = Number.parseFloat(/translateY\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? 'x');
      expect(y % ROW_HEIGHT, transform).toBe(0);
    }
    const list = (await box(page, '.graph__scroll')).h;
    await drag(page, EDGE, 0, -100);
    expect((await box(page, AREA)).h).toBe(350);
    expect((await box(page, '.graph__scroll')).h).toBe(list - 100);
    await drag(page, EDGE, 0, -3000);
    expect((await box(page, '.graph__scroll')).h).toBeGreaterThanOrEqual(4 * ROW_HEIGHT);
  });
});

test('docked: the close control, a second click, another row and Escape do what they do inline', async () => {
  await withBudgeted({ open: fixture('details', 'script', 6) }, async ({ page }) => {
    await ready(page);
    await openRow(page, MOVE);
    await choose(page, 'Location', 'Docked to Bottom');
    await page.locator('.details__close').click();
    await expect(page.locator(AREA)).toHaveCount(0);
    await openRow(page, MOVE);
    await page.locator('.row', { hasText: MOVE }).locator('.row__subject').click();
    await expect(page.locator(AREA)).toHaveCount(0);
    await openRow(page, MOVE);
    await openRow(page, MERGE);
    await expect(page.locator('.row--open')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator(AREA)).toHaveCount(0);
  });
});

test('docked: the canvas above the panel is the closed graph, and a change of place asks for nothing', async () => {
  await withBudgeted({ open: fixture('details', 'script', 6) }, async ({ page }) => {
    await ready(page);
    await openRow(page, MERGE);
    await page.evaluate(watchInfo);
    const text = await page.locator(INFO).textContent();
    await choose(page, 'Location', 'Docked to Bottom');
    const scroll = await page.evaluate(offset);
    const docked = await canvasOf(page);
    const height = await page.evaluate(viewportHeight);
    await choose(page, 'Location', 'Inline');
    await choose(page, 'Location', 'Docked to Bottom');
    expect(await page.locator(INFO).textContent()).toBe(text);
    // A second ask writes the loading note again; none was written.
    expect(await page.evaluate(seenInfo)).not.toContain('Loading…');
    await page.locator('.details__close').click();
    await page.evaluate(scrollListTo, scroll);
    await painted(page);
    const closed = await canvasOf(page);
    for (let y = 0; y < height - 2; y += 3) {
      for (const x of [10, laneCentreX(0), laneCentreX(1), laneCentreX(1) + 4]) {
        expect(docked(x, y), `${String(x)},${String(y)}`).toEqual(closed(x, y));
      }
    }
  });
});

test('docked: the last row and Load More are reached by scrolling the list above the panel', async () => {
  await withBudgeted({ open: fixture('large', 'large', 10_000) }, async ({ page }) => {
    await ready(page);
    await page.locator('.row:not([hidden])').nth(3).locator('.row__subject').click();
    await expect(page.locator(AREA)).toBeVisible();
    await choose(page, 'Location', 'Docked to Bottom');
    await page.evaluate(scrollListTo, 1e9);
    await painted(page);
    const [more, panel, list] = [
      await box(page, '.graph__more'),
      await box(page, AREA),
      await box(page, '.graph__scroll'),
    ];
    expect(list.y + list.h).toBeLessThanOrEqual(panel.y + 1);
    expect(more.y + more.h).toBeLessThanOrEqual(panel.y + 1);
    expect(more.y).toBeGreaterThan(list.y);
  });
});
