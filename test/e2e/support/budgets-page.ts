import type { GitGraphicalBridge, GraphPage } from '../../../src/contracts/index';

/**
 * What the budget suites run **inside the window**, and nothing else.
 *
 * Every function here is handed to Playwright, which sends its source text to
 * the page and runs it there. So none of them may name a value outside its own
 * body — not a constant of this module, not a helper — and the elements they
 * touch are described by the interfaces below, which are types and vanish before
 * the text is sent, because `tsconfig.node.json` has no DOM library.
 *
 * The five `install…` functions are **init scripts**: added to the
 * application's browser context by `launchBudgeted` in `./budgets.ts` straight
 * after launch, in the order they are declared, so that they run in every
 * document before `renderer.js` does. Installed any later they would miss what
 * the renderer registered while mounting, which is exactly where a polling loop
 * would be written. Each records whether the renderer's view already existed
 * when it ran, and the suites refuse a reading taken after it did.
 *
 * ### What "painted" means here
 *
 * The renderer writes the rows and redraws the graph canvas inside one
 * animation-frame callback (`src/ui/graph-table.ts`, `paint`), and changes the
 * bar and the failure view in the task that received a reply. A mutation
 * observer sees each batch of changes to the document; for every batch it asks
 * for an animation frame and, inside that, for **another** one. The second
 * callback takes the mark: `performance.now()`, the wall clock, and a reading of
 * what the window then shows, canvas pixels included.
 *
 * Animation-frame callbacks run at the start of a rendering update, and style,
 * layout and paint run after them in the same update; that is the order the HTML
 * event loop gives the steps, and a callback asked for while callbacks are
 * running waits for the next update. The first callback runs in an update that
 * begins after the change was made — the change was made in a task, or in an
 * earlier callback of the same run — so that update paints the change. The
 * second runs in a later update, which cannot begin until that paint is done.
 * **So a mark is never earlier than the paint of the change it follows.** It is
 * late by what is left of one update and a second one: measured on this machine
 * on 2026-09-28 by recording both callbacks' frame times, between 1.6 ms, when
 * the first update started late behind a busy task and the second followed on
 * the next vsync, and 34 ms, two whole 60 Hz frames.
 *
 * What a mark does not see is the compositor putting the frame on the screen.
 * Chromium times that only for the first contentful paint, and
 * `budgets-start.spec.ts` holds the first mark of every cold start to be no
 * earlier than that paint's own `paintTime`, which is the one check of this
 * argument against Chromium's own clock.
 */

/** What the window shows at a mark. */
export interface PaintState {
  /** Rows the spacer is sized for: the page's row count, uncommitted row included. */
  readonly rows: number;
  /** The text of the row drawn at the top of the list, or `''`. */
  readonly firstRow: string;
  /** What the bar says the open repository is. */
  readonly path: string;
  /** The Refresh control's label, and whether it can be pressed. */
  readonly refresh: string;
  readonly refreshDisabled: boolean;
  /** Whether the table is shown at all. */
  readonly viewShown: boolean;
  /** Canvas pixels, one in sixteen sampled, that are not transparent. */
  readonly ink: number;
}

/** One mark: when a change was seen, and the frame after it had been painted. */
export interface PaintMark {
  readonly changedAt: number;
  readonly paintedAt: number;
  /** `Date.now()` at `paintedAt`, to set against a clock outside the page. */
  readonly wall: number;
  readonly state: PaintState;
}

/** Everything the init scripts collected. */
export interface ProbeReading {
  readonly marks: readonly PaintMark[];
  /** Timers and frames the page asked for, by kind. */
  readonly registered: Readonly<Record<string, number>>;
  /** Callbacks of those that ran, by kind: the page's wakeups. */
  readonly fired: Readonly<Record<string, number>>;
  /** Canvas repaints: calls of `clearRect`, which `paintGraph` makes once per redraw. */
  readonly redraws: number;
  /** One entry per init script: whether it ran before the renderer published its view. */
  readonly beforeRenderer: readonly boolean[];
}

type Callback = (...values: unknown[]) => void;
type Scheduler = (callback: Callback, ...rest: unknown[]) => number;

interface Probe {
  marks: PaintMark[];
  marking: boolean;
  registered: Record<string, number>;
  fired: Record<string, number>;
  redraws: number;
  beforeRenderer: boolean[];
  /** The page's own `requestAnimationFrame`, taken before it is counted. */
  frame: (callback: (time: number) => void) => number;
  read: () => PaintState;
}

interface Found {
  readonly textContent: string | null;
  readonly hidden: boolean;
  readonly disabled?: boolean;
  readonly clientHeight: number;
  readonly width: number;
  readonly height: number;
  readonly style: { readonly transform: string };
  scrollTop: number;
  click: () => void;
  getContext: (kind: '2d') => {
    getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
  } | null;
}

interface Scope {
  budgetProbe: Probe;
  gitGraphical: GitGraphicalBridge;
  gitGraphicalView: { showPage: (page: GraphPage) => void };
  requestAnimationFrame: Scheduler;
  setTimeout: Scheduler;
  setInterval: Scheduler;
  requestIdleCallback: Scheduler;
  MutationObserver: new (fn: () => void) => { observe: (at: object, o: object) => void };
  MessageChannel: new () => {
    port1: { onmessage: (() => void) | null };
    port2: { postMessage: (value: number) => void };
  };
  CanvasRenderingContext2D: { prototype: { clearRect: (...box: number[]) => void } };
  document: {
    querySelector: (at: string) => Found | null;
    querySelectorAll: (at: string) => Iterable<Found>;
  };
  performance: { now: () => number };
  btoa: (text: string) => string;
}

/** Init script 1: the probe itself, holding the page's own frame scheduler. */
export function installProbe(): void {
  const scope = globalThis as unknown as Scope;
  const frame = scope.requestAnimationFrame.bind(scope) as Probe['frame'];
  scope.budgetProbe = {
    marks: [],
    marking: true,
    registered: {},
    fired: {},
    redraws: 0,
    beforeRenderer: [!('gitGraphicalView' in scope)],
    frame,
    read: () => {
      throw new Error('the state reader was not installed');
    },
  };
}

/** Init script 2: how a mark reads what the window shows. */
export function installStateReader(): void {
  const scope = globalThis as unknown as Scope;
  const probe = scope.budgetProbe;
  probe.beforeRenderer.push(!('gitGraphicalView' in scope));
  const find = (at: string): Found | null => scope.document.querySelector(at);
  const ink = (): number => {
    const canvas = find('.graph__canvas');
    const context = canvas === null || canvas.width === 0 ? null : canvas.getContext('2d');
    if (canvas === null || context === null) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let at = 3; at < data.length; at += 64) inked += data[at] === 0 ? 0 : 1;
    return inked;
  };
  const firstRow = (): string => {
    for (const row of scope.document.querySelectorAll('.row')) {
      if (!row.hidden && row.style.transform === 'translateY(0px)') return row.textContent ?? '';
    }
    return '';
  };
  probe.read = (): PaintState => ({
    rows: Math.round((find('.graph__spacer')?.clientHeight ?? 0) / 24),
    firstRow: firstRow(),
    path: find('.bar__path')?.textContent ?? '',
    refresh: find('.bar__refresh')?.textContent ?? '',
    refreshDisabled: find('.bar__refresh')?.disabled ?? true,
    viewShown: find('.graph')?.hidden === false,
    ink: ink(),
  });
}

/** Init script 3: a mark after every painted change to the document. */
export function installPaintMarks(): void {
  const scope = globalThis as unknown as Scope;
  const probe = scope.budgetProbe;
  probe.beforeRenderer.push(!('gitGraphicalView' in scope));
  const observer = new scope.MutationObserver(() => {
    if (!probe.marking) return;
    const changedAt = scope.performance.now();
    probe.frame(() => {
      probe.frame(() => {
        const paintedAt = scope.performance.now();
        probe.marks.push({ changedAt, paintedAt, wall: Date.now(), state: probe.read() });
      });
    });
  });
  observer.observe(scope.document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
}

/**
 * Init script 4: count every timer and frame the page asks for, and every
 * callback of one that runs.
 *
 * `setTimeout`, `setInterval`, `requestAnimationFrame` and
 * `requestIdleCallback` are every way a page can ask to be woken later. What
 * this cannot see is work Chromium schedules for itself — a caret blink, a
 * compositor animation, a garbage collection — which never passes through the
 * page's globals; the operating system's CPU time for the renderer process,
 * read beside it, is what covers that.
 */
export function installTimerCounters(): void {
  const scope = globalThis as unknown as Scope;
  const probe = scope.budgetProbe;
  probe.beforeRenderer.push(!('gitGraphicalView' in scope));
  const kinds = ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback'];
  for (const kind of kinds) {
    const original = (scope[kind as keyof Scope] as Scheduler).bind(scope);
    probe.registered[kind] = 0;
    probe.fired[kind] = 0;
    const counted: Scheduler = (callback, ...rest) => {
      probe.registered[kind] = (probe.registered[kind] ?? 0) + 1;
      const wrapped: Callback = (...values) => {
        probe.fired[kind] = (probe.fired[kind] ?? 0) + 1;
        callback(...values);
      };
      return original(wrapped, ...rest);
    };
    Object.assign(scope, { [kind]: counted });
  }
}

/** Init script 5: count canvas repaints, one `clearRect` each. */
export function installRedrawCounter(): void {
  const scope = globalThis as unknown as Scope;
  const probe = scope.budgetProbe;
  probe.beforeRenderer.push(!('gitGraphicalView' in scope));
  const prototype = scope.CanvasRenderingContext2D.prototype;
  const clear = prototype.clearRect;
  prototype.clearRect = function counting(this: unknown, ...box: number[]): void {
    probe.redraws += 1;
    clear.apply(this, box);
  };
}

/** Runs in the page: everything collected so far. */
export function readProbe(): ProbeReading {
  const probe = (globalThis as unknown as Scope).budgetProbe;
  return {
    marks: [...probe.marks],
    registered: { ...probe.registered },
    fired: { ...probe.fired },
    redraws: probe.redraws,
    beforeRenderer: [...probe.beforeRenderer],
  };
}

/** Runs in the page: switch marking on or off, and forget the marks taken. */
export function setMarking(on: boolean): void {
  const probe = (globalThis as unknown as Scope).budgetProbe;
  probe.marking = on;
  probe.marks.length = 0;
}

/** Runs in the page: `performance.now()`, then press Refresh. */
export function pressRefresh(): number {
  const scope = globalThis as unknown as Scope;
  const at = scope.performance.now();
  scope.document.querySelector('.bar__refresh')?.click();
  return at;
}

/** What a Load More answered: how many commits the page holds, and how long it took. */
export interface LoadedPage {
  readonly commits: number;
  readonly rows: number;
  readonly milliseconds: number;
}

/**
 * Runs in the page: ask for `count` more commits over the bridge and hand the
 * answer to the view, which is what the Load More control does with its own
 * count (`src/ui/renderer.ts`).
 */
export async function loadMoreAndShow(count: number): Promise<LoadedPage> {
  const scope = globalThis as unknown as Scope;
  const at = scope.performance.now();
  const reply = await scope.gitGraphical.loadMoreCommits({ count });
  if (!reply.ok) throw new Error(reply.message);
  scope.gitGraphicalView.showPage(reply.value);
  return {
    commits: reply.value.commits.count,
    rows: reply.value.layout.rowCount,
    milliseconds: scope.performance.now() - at,
  };
}

/** Runs in the page: how many row elements the document holds, hidden ones included. */
export function countRowElements(): number {
  return [...(globalThis as unknown as Scope).document.querySelectorAll('.row')].length;
}

/** Runs in the page: the canvas's height in CSS pixels, which is the viewport's. */
export function viewportHeight(): number {
  return (
    (globalThis as unknown as Scope).document.querySelector('.graph__canvas')?.clientHeight ?? -1
  );
}

/** Runs in the page: put the list at `offset`. */
export function scrollListTo(offset: number): number {
  const list = (globalThis as unknown as Scope).document.querySelector('.graph__scroll');
  if (list === null) return -1;
  list.scrollTop = offset;
  return list.scrollTop;
}

/** A scripted scroll, and what each of its frames cost the main thread. */
export interface FrameSample {
  /** Milliseconds of main-thread work, one entry per frame. */
  readonly work: readonly number[];
  /** Canvas repaints the renderer made while the frames ran. */
  readonly redraws: number;
}

/**
 * Runs in the page: scroll by `step` pixels once a frame for `frames` frames,
 * and time the main thread's work in each.
 *
 * A frame's work is timed **from the first animation-frame callback of its
 * rendering update to the first task after it**. The callback that scrolls is
 * the first one of each update, because it was requested in the task after the
 * previous update, before the renderer's own request, which its scroll listener
 * makes in the next update's scroll steps. Posting a message from that callback
 * is the end mark: a message is a task, and no task runs until the rendering
 * update that is running — the renderer's `paint`, then style, layout, paint and
 * the hand-over to the compositor — has finished.
 *
 * So each timed frame holds this scroll's write, the renderer's repaint for the
 * scroll one frame earlier, and all the rendering between. What it leaves out is
 * the scroll listener itself, which runs before the first callback and only asks
 * for a frame, and anything on another thread: rasterising and compositing are
 * not the main thread's.
 */
export async function sampleScrollFrames(input: {
  frames: number;
  step: number;
}): Promise<FrameSample> {
  const scope = globalThis as unknown as Scope;
  const probe = scope.budgetProbe;
  const list = scope.document.querySelector('.graph__scroll');
  const spacer = scope.document.querySelector('.graph__spacer');
  if (list === null || spacer === null) throw new Error('no list to scroll');
  const room = Math.max(1, spacer.clientHeight - list.clientHeight);
  const channel = new scope.MessageChannel();
  const work: number[] = [];
  const redrawsBefore = probe.redraws;
  let started = 0;
  const tick = (): void => {
    started = scope.performance.now();
    list.scrollTop = (list.scrollTop + input.step) % room;
    channel.port2.postMessage(0);
  };
  return new Promise<FrameSample>((done) => {
    channel.port1.onmessage = (): void => {
      work.push(scope.performance.now() - started);
      if (work.length < input.frames) {
        probe.frame(tick);
        return;
      }
      done({ work, redraws: probe.redraws - redrawsBefore });
    };
    probe.frame(tick);
  });
}

/** The graph canvas's pixels, as the page holds them. */
export interface CanvasPixels {
  readonly width: number;
  readonly height: number;
  /** Unpremultiplied RGBA, row by row, base64. */
  readonly rgba: string;
}

/** Runs in the page: read the graph canvas back, byte for byte. */
export function readCanvas(): CanvasPixels {
  const scope = globalThis as unknown as Scope;
  const canvas = scope.document.querySelector('.graph__canvas');
  const context = canvas?.getContext('2d') ?? null;
  if (canvas === null || context === null) return { width: 0, height: 0, rgba: '' };
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let binary = '';
  for (let at = 0; at < data.length; at += 0x8000) {
    binary += String.fromCharCode(...data.subarray(at, at + 0x8000));
  }
  return { width: canvas.width, height: canvas.height, rgba: scope.btoa(binary) };
}
