import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { entryAt } from '../../src/contracts/column-read';
import { HASH_BYTE_LENGTH, RefKind, RowFlag, UNKNOWN_INDEX } from '../../src/contracts/index';
import type { CommitColumns, GraphPage, LayoutRows, Refs } from '../../src/contracts/index';
import { createLayoutState, layoutPage } from '../../src/core/layout/index';
import { OVERSCAN_ROWS, visibleRowCount } from '../../src/ui/geometry';
import { rowViewAt } from '../../src/ui/row-model';
import { withOwnProfile } from './support/fixtures';

/**
 * The built application drawing a fixture page, and the row model behind it.
 *
 * **The fixture is the real layout engine's output**, not a hand-drawn
 * imitation of it: `fixturePage` builds a `CommitColumns` and hands it to
 * `src/core/layout/`, so what the renderer is asked to draw here is what S06
 * will hand it. Typed arrays cross `page.evaluate` unchanged, which was
 * measured in this lane before the fixture was written this way.
 *
 * The three counters the window is judged on are installed **by the driver, in
 * the page**, so that nothing ships to a user for the sake of a test:
 * `clearRect` runs once per repaint, `requestAnimationFrame` once per frame the
 * view asks for (and its callback once more when that frame has run), and
 * `setTimeout` and `setInterval` are what an idle window must not touch at all.
 *
 * The pure arithmetic under this view is in `graph-geometry.spec.ts`, which says
 * why neither file is a colocated `src/ui/*.test.ts`.
 */

/** Two authors, so that the author column is not constant. */
const PEOPLE = {
  names: ['Ada Lovelace', 'Grace Hopper'],
  emails: ['ada@example.invalid', 'grace@example.invalid'],
};

const VERBS = ['add', 'fix', 'refactor', 'document', 'measure'];

/**
 * A page whose shape exercises every case the painter has.
 *
 * - every commit's first parent is the next one, which is the mainline;
 * - one commit in twelve is a **merge**, with a second parent three rows down,
 *   so a line leaves its vertex, crosses the rows between in a lane of its own
 *   and leans back in;
 * - one commit in twelve skips four rows, which leaves the commit after it with
 *   no child at all: a **branch tip** carrying `ClipAboveVertex`, whose own line
 *   descends a lane of its own until it rejoins;
 * - the last commit has an **unloaded** parent when `hasMore`, and **no parent
 *   at all** when not, which is the root that carries `ClipBelowVertex`. The two
 *   are spelled identically everywhere else, which is the whole reason that bit
 *   exists.
 */
function fixtureCommits(count: number, hasMore: boolean): CommitColumns {
  const hashes = new Uint8Array(count * HASH_BYTE_LENGTH);
  for (let byte = 0; byte < hashes.length; byte += 1) {
    const row = Math.floor(byte / HASH_BYTE_LENGTH);
    hashes[byte] = (row * 31 + (byte % HASH_BYTE_LENGTH) * 7) & 0xff;
  }
  const parentOffsets = new Uint32Array(count + 1);
  const parents: number[] = [];
  const subjectOffsets = new Uint32Array(count + 1);
  let subjects = '';
  for (let row = 0; row < count; row += 1) {
    parentOffsets[row] = parents.length;
    const first = row + (row % 12 === 6 && row + 4 < count ? 4 : 1);
    if (first < count) {
      parents.push(first);
    } else if (hasMore) {
      parents.push(UNKNOWN_INDEX);
    }
    if (row % 12 === 0 && row + 3 < count) parents.push(row + 3);
    subjects += `${VERBS[row % VERBS.length] ?? 'add'} the widget in row ${String(row)}`;
    subjectOffsets[row + 1] = subjects.length;
  }
  parentOffsets[count] = parents.length;
  const each = Array.from({ length: count }, (_unused, row) => row);
  return {
    count,
    hashes,
    parentOffsets,
    parentIndices: Uint32Array.from(parents),
    authorId: Uint32Array.from(each.map((row) => row % 2)),
    committerId: Uint32Array.from(each.map((row) => (row + 1) % 2)),
    authorTime: Float64Array.from(each.map((row) => 1700000000 - row * 3600)),
    commitTime: Float64Array.from(each.map((row) => 1700000000 - row * 3600)),
    authorTzMinutes: Int16Array.from(each.map((row) => (row % 2 === 0 ? 0 : -300))),
    commitTzMinutes: new Int16Array(count),
    subjectOffsets,
    subjects,
    people: PEOPLE,
  };
}

/** Four references, one of them a kind the description column must not show. */
function fixtureRefs(): Refs {
  const { LocalHead, RemoteBranch, Tag, RemoteSymbolicHead } = RefKind;
  const names = ['main', 'origin/main', 'v1.4.0', 'origin/HEAD'];
  const nameOffsets = new Uint32Array(names.length + 1);
  names.forEach((name, at) => (nameOffsets[at + 1] = entryAt(nameOffsets, at) + name.length));
  return {
    count: names.length,
    kind: Uint8Array.of(LocalHead, RemoteBranch, Tag, RemoteSymbolicHead),
    commitIndex: Uint32Array.of(0, 0, 2, 0),
    nameOffsets,
    names: names.join(''),
    flags: new Uint8Array(names.length),
  };
}

/**
 * Prepend the uncommitted row, the way S06 will.
 *
 * `src/core/layout/` never sees this row — it is not a commit — so the shift is
 * the caller's, and `src/contracts/graph-page.ts` fixes it at row 0, with one
 * segment of its own in lane 0.
 */
function withUncommittedRow(rows: LayoutRows): LayoutRows {
  const rowCount = rows.rowCount + 1;
  const laneIndex = new Uint16Array(rowCount);
  const colourIndex = new Uint8Array(rowCount);
  const flags = new Uint8Array(rowCount);
  const segmentOffsets = new Uint32Array(rowCount + 1);
  laneIndex.set(rows.laneIndex, 1);
  colourIndex.set(rows.colourIndex, 1);
  flags.set(rows.flags, 1);
  flags[0] = RowFlag.Uncommitted | RowFlag.ClipAboveVertex;
  for (let row = 0; row <= rows.rowCount; row += 1) {
    segmentOffsets[row + 1] = entryAt(rows.segmentOffsets, row) + 1;
  }
  return {
    ...rows,
    rowCount,
    laneIndex,
    colourIndex,
    flags,
    segmentOffsets,
    segmentFromLane: Uint16Array.of(0, ...rows.segmentFromLane),
    segmentToLane: Uint16Array.of(0, ...rows.segmentToLane),
    segmentColour: Uint8Array.of(0, ...rows.segmentColour),
  };
}

/** One whole page, laid out by the engine that will lay out the real one. */
function fixturePage(count: number, dirty: boolean, hasMore: boolean): GraphPage {
  const commits = fixtureCommits(count, hasMore);
  const laid = layoutPage(createLayoutState(), commits, 0);
  return {
    commits,
    refs: fixtureRefs(),
    workingTree: {
      hasChanges: dirty,
      changedFileCount: 2,
      untrackedFileCount: 1,
      headCommitIndex: 0,
      headRefName: 'main',
      isDetached: false,
    },
    layout: dirty ? withUncommittedRow(laid) : laid,
    hasMore,
  };
}

type Counters = Record<'frames' | 'ran' | 'draws' | 'strokes' | 'timers' | 'asked', number>;

type Timer = (callback: () => void, ms?: number) => number;

interface PageScope {
  requestAnimationFrame: (callback: () => void) => number;
  setTimeout: Timer;
  setInterval: Timer;
  Event: new (type: string) => object;
  CanvasRenderingContext2D: { prototype: ContextLike };
  document: { querySelector: (at: string) => ScrollerLike | null };
  gitGraphicalView: { showPage: (p: GraphPage) => void; onLoadMore: (fn: () => void) => void };
  fixtureCounters: Counters;
  loadMoreAsked: boolean;
}

interface ContextLike {
  clearRect: (x: number, y: number, width: number, height: number) => void;
  stroke: () => void;
}

interface ScrollerLike {
  scrollTop: number;
  clientHeight: number;
  dispatchEvent: (event: object) => boolean;
}

/** Runs in the page: hand the mounted view a page, and listen for its intent. */
function handPage(page: GraphPage): void {
  const scope = globalThis as unknown as PageScope;
  scope.loadMoreAsked = false;
  scope.gitGraphicalView.onLoadMore(() => (scope.loadMoreAsked = true));
  scope.gitGraphicalView.showPage(page);
}

/**
 * Runs in the page: put the scroller at each offset in turn, all in one task,
 * announcing each move as its own `scroll` event.
 *
 * **The announcement is the whole of the coalescing probe.** Chromium coalesces
 * programmatic scrolling by itself: measured in this lane, twenty-five
 * `scrollTop` writes in one task produced **one** scroll event, so a view that
 * requested an animation frame for every event it received still redrew once,
 * and the assertion below passed with the view's own coalescing removed. A
 * green check that cannot fail is what `AGENTS.md` §7 is about. Dispatching the
 * events makes the listener run once per move, which is the path the view's
 * `schedule` is the only thing standing in.
 */
function scrollTo(offsets: readonly number[]): number {
  const scope = globalThis as unknown as PageScope;
  const element = scope.document.querySelector('.graph__scroll');
  if (element === null) return -1;
  for (const offset of offsets) {
    element.scrollTop = offset;
    element.dispatchEvent(new scope.Event('scroll'));
  }
  return element.scrollTop;
}

/** Runs in the page: the canvas's height, which is the height of the viewport. */
function measureViewport(): number {
  const scope = globalThis as unknown as PageScope;
  return scope.document.querySelector('.graph__canvas')?.clientHeight ?? -1;
}

/**
 * Runs in the page: count frames asked for and run, repaints, strokes and timer
 * registrations.
 *
 * Installed through `addInitScript` and a reload, so that it is in place
 * **before** `renderer.js` runs. Installed afterwards it would miss whatever the
 * view registered while mounting, which is exactly where a polling loop would be
 * written, and `timers` would then be zero for a window that wakes ten times a
 * second.
 *
 * `frames` counts the frames the view asks for, when it asks; `ran` counts them
 * again once their callback has returned, and `readCounters` reports the
 * difference as `due`. No frame the view asked for is still to run when `due`
 * is 0, which is what a case waits for before it reads a count a frame changes.
 */
function installCounters(): void {
  const scope = globalThis as unknown as PageScope;
  const counters: Counters = { frames: 0, ran: 0, draws: 0, strokes: 0, timers: 0, asked: 0 };
  scope.fixtureCounters = counters;
  const counted =
    (original: Timer, key: 'frames' | 'timers'): Timer =>
    (callback, ms): number => {
      counters[key] += 1;
      // A frame is counted again, in `ran`, once its callback has returned.
      return original(() => (callback(), (counters.ran += Number(key === 'frames'))), ms);
    };
  scope.requestAnimationFrame = counted(scope.requestAnimationFrame.bind(scope), 'frames');
  scope.setTimeout = counted(scope.setTimeout.bind(scope), 'timers');
  scope.setInterval = counted(scope.setInterval.bind(scope), 'timers');
  const prototype = scope.CanvasRenderingContext2D.prototype;
  const { clearRect: clear, stroke } = prototype;
  prototype.clearRect = function counting(this: ContextLike, ...box: number[]): void {
    counters.draws += 1;
    clear.call(this, box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0);
  };
  prototype.stroke = function counting(this: ContextLike): void {
    counters.strokes += 1;
    stroke.call(this);
  };
}

/**
 * Runs in the page: what the counters say now, whether the intent arrived, and
 * how many frames the view asked for are still to run.
 */
function readCounters(): Counters & { due: number } {
  const { fixtureCounters: counted, loadMoreAsked } = globalThis as unknown as PageScope;
  return { ...counted, asked: loadMoreAsked ? 1 : 0, due: counted.frames - counted.ran };
}

/**
 * Launch the built application on a user-data directory of its own, run `body`
 * against its window, and stop it.
 *
 * Every process this suite starts is stopped by it: `withOwnProfile`
 * (`./support/fixtures.ts`) reads the exit status back afterwards, because a
 * leaked process is a failure of the gate whatever the assertions said.
 */
async function withWindow(body: (page: Page) => Promise<void>): Promise<void> {
  await withOwnProfile({}, async (application) => body(await application.firstWindow()));
}

test('a row shows its own commit, in the author’s own time zone', () => {
  const page = fixturePage(24, true, true);
  const view = rowViewAt(page, 4);
  expect(view.isUncommitted).toBe(false);
  expect(view.description).toBe('document the widget in row 3');
  expect(view.author).toBe('Grace Hopper');
  expect(view.hash).toBe('5d646b72');
  expect(view.date).toBe('2023-11-14 14:13');
  expect(rowViewAt(page, 1).date).toBe('2023-11-14 22:13');
});

test('the uncommitted row sits above every commit and counts its own files', () => {
  const page = fixturePage(24, true, true);
  const view = rowViewAt(page, 0);
  expect(view.isUncommitted).toBe(true);
  expect(view.description).toBe('Uncommitted changes (3)');
  expect(view.hash).toBe('');
  expect(view.labels).toEqual([]);
  const clean = { ...page, workingTree: { ...page.workingTree, hasChanges: false } };
  expect(rowViewAt(clean, 0).hash).toBe('00070e15');
});

test('labels sit on their own commit, in kind order, and only the three kinds', () => {
  const page = fixturePage(24, false, true);
  expect(rowViewAt(page, 0).labels).toEqual([
    { kind: RefKind.LocalHead, name: 'main' },
    { kind: RefKind.RemoteBranch, name: 'origin/main' },
  ]);
  expect(rowViewAt(page, 2).labels).toEqual([{ kind: RefKind.Tag, name: 'v1.4.0' }]);
  expect(rowViewAt(page, 1).labels).toEqual([]);
});

test('the fixture carries every shape the painter has a case for', () => {
  const bits = (rows: LayoutRows): number => [...rows.flags].reduce((all, one) => all | one, 0);
  const open = fixturePage(24, true, true).layout;
  const wanted = RowFlag.ClipAboveVertex | RowFlag.Merge | RowFlag.Uncommitted;
  expect(bits(open) & wanted).toBe(wanted);
  expect(bits(open) & RowFlag.ClipBelowVertex).toBe(0);
  expect(bits(fixturePage(24, false, false).layout) & RowFlag.ClipBelowVertex).not.toBe(0);
  expect(open.maxLane).toBeGreaterThan(0);
  expect([...open.segmentFromLane].some((lane, at) => lane !== open.segmentToLane[at])).toBe(true);
});

test('the window draws a page: rows, labels, lines and the Load More control', async () => {
  await withWindow(async (page) => {
    await page.addInitScript(installCounters);
    await page.reload();
    await page.evaluate(handPage, fixturePage(96, true, true));
    await expect(page.locator('.graph__head')).toContainText('Description');
    await expect(page.locator('.row').first()).toContainText('Uncommitted changes (3)');
    await expect(page.locator('.row').nth(1)).toContainText('add the widget in row 0');
    await expect(page.locator('.ref').first()).toHaveText('main');
    await expect(page.locator('.ref--tag')).toHaveText('v1.4.0');
    await expect(page.locator('.graph__more')).toBeVisible();
    const drawn = await page.evaluate(readCounters);
    process.stdout.write(`drew ${String(drawn.strokes)} strokes, ${String(drawn.draws)} redraws\n`);
    expect(drawn.strokes).toBeGreaterThan(20);
    await page.locator('.graph__more').click();
    expect((await page.evaluate(readCounters)).asked).toBe(1);
    await page.evaluate(handPage, fixturePage(20, true, false));
    await expect(page.locator('.graph__more')).toBeHidden();
    await expect(page.locator('.row:visible')).toHaveCount(21);
  });
});

test('live row elements stay inside the budget, at page sizes an order apart', async () => {
  await withWindow(async (page) => {
    // The rows are made and written by the frame the view asks for, so a count
    // read before that frame has run reads the rows of the page before, or none.
    // Every count waits until no frame the view asked for is still to run, never
    // for a time; the poll's limit is the configured `expect` one.
    await page.addInitScript(installCounters);
    await page.reload();
    await page.evaluate(handPage, fixturePage(1000, false, true));
    await expect.poll(() => page.evaluate(readCounters)).toMatchObject({ due: 0 });
    const bound = visibleRowCount(await page.evaluate(measureViewport)) + 2 * OVERSCAN_ROWS;
    const small = await page.locator('.row').count();
    await page.evaluate(handPage, fixturePage(10000, false, true));
    for (const offset of [40000, 120000, 239000, 0]) {
      await page.evaluate(scrollTo, [offset]);
      await expect.poll(() => page.evaluate(readCounters)).toMatchObject({ due: 0 });
    }
    const large = await page.locator('.row').count();
    process.stdout.write(
      `live rows: ${String(small)} at 1000 rows, ${String(large)} at 10000, bound ${String(bound)}\n`,
    );
    expect(small).toBe(large);
    expect(large).toBeLessThanOrEqual(bound);
    await expect(page.locator('.row').first()).toContainText('the widget in row 0');
  });
});

test('scroll events in one task cost one redraw, and an idle window costs none', async () => {
  await withWindow(async (page) => {
    await page.addInitScript(installCounters);
    await page.reload();
    await page.evaluate(handPage, fixturePage(10000, false, true));
    // Wait for what is counted, never for a time: under load the reviewer of
    // E03-M01's round 02 read no draw at all 800 ms after the page was handed.
    // First no frame the handed page asked for is still to run, which is after
    // it was drawn, so the burst asks for a frame of its own; then no frame the
    // burst asked for is still to run. The burst asks for all of its frames in
    // one task, so they all run in one frame and `after` holds every one of them,
    // as many as a renderer over its bound asks for. A poll's limit is the
    // configured `expect` one.
    await expect.poll(() => page.evaluate(readCounters)).toMatchObject({ due: 0 });
    const settled = await page.evaluate(readCounters);
    const burst = Array.from({ length: 25 }, (_unused, step) => (step + 1) * 53);
    expect(await page.evaluate(scrollTo, burst)).toBe(25 * 53);
    await expect.poll(() => page.evaluate(readCounters)).toMatchObject({ due: 0 });
    const after = await page.evaluate(readCounters);
    const [drew, ask] = [after.draws - settled.draws, after.frames - settled.frames];
    process.stdout.write(`burst of 25 offsets: ${String(drew)} redraws in ${String(ask)} frames\n`);
    expect(settled.draws).toBeGreaterThan(0);
    expect(after.draws).toBeGreaterThan(settled.draws);
    expect(after.draws - settled.draws).toBeLessThanOrEqual(2);
    expect(after.draws).toBeLessThanOrEqual(after.frames);
    // The idle stretch holds an absence, so it is a time by nature, kept at the
    // two seconds it had. A timer is counted from the page's first script,
    // whatever its period, so the length bounds only frames: a frame loop asks
    // again from inside a frame that runs, and `frames` counts it when it asks.
    await page.waitForTimeout(2000);
    const idle = await page.evaluate(readCounters);
    expect(idle.frames).toBe(after.frames);
    expect(idle.draws).toBe(after.draws);
    expect(idle.timers).toBe(0);
  });
});
