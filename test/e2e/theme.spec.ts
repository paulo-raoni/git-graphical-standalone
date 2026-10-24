import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { readCanvas, scrollListTo } from './support/budgets-page';
import { fixture } from './support/fixtures';

/**
 * The colour-scheme control in the bar, driven through the built application.
 *
 * **The operating system's preference is emulated through Playwright's
 * `colorScheme`**, which sets the `prefers-color-scheme` the page sees, and is
 * light unless a launch says otherwise: that is the scheme every other suite of
 * this folder runs in. The emulation sits above everything the application does
 * to the preference, so while it is in force the page's colours are decided by
 * the control's `data-theme` alone, and the main process's half of a choice —
 * `nativeTheme.themeSource`, which moves the frame, the menu bar and the
 * preference the page sees — is read back from the main process. The relaunch
 * case turns the emulation off, because what it holds is that main-process half:
 * the stored choice is the preference the document has before it first paints.
 *
 * **Every launch has a user-data directory of its own** (`--user-data-dir`), so
 * a choice made here is never left behind for another suite or for the person
 * who runs this one, and a fresh directory is a first start. Colours are read
 * from computed styles, never from a screenshot.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(repositoryRoot, 'test', 'e2e', 'golden', 'graph-branch-and-merge.rgba.deflate');

/** `--surface` of each scheme in `src/ui/renderer.css`, as a computed style spells it. */
const LIGHT_SURFACE = 'rgb(255, 255, 255)';
const DARK_SURFACE = 'rgb(31, 31, 31)';

/** Long enough for a ten-thousand-commit fixture to be written and read. */
const SLOW_TEST_MS = 240_000;

type Scheme = 'light' | 'dark';
type Choice = Scheme | 'system';

/** What `surface` is for a scheme. */
function surfaceOf(scheme: Scheme): string {
  return scheme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
}

interface Launched {
  readonly application: ElectronApplication;
  readonly page: Page;
}

interface LaunchOptions {
  /** The emulated preference, or `null` for the operating system's own. Light when absent. */
  readonly emulated?: Scheme | null;
  readonly open?: string;
  readonly switches?: readonly string[];
  /** Runs in every document of the application before its own scripts do. */
  readonly initScript?: () => void;
}

/**
 * The part of the window's global the page-side functions below read. They are
 * sent to the page as source text, so they name nothing outside their own body,
 * and this is a type, which vanishes before they are sent: `tsconfig.node.json`
 * has no DOM library.
 */
interface Element {
  readonly scrollTop: number;
  readonly clientHeight: number;
}
interface PageScope {
  readonly document: {
    readonly body: Element | null;
    readonly documentElement: Element & { readonly dataset: Record<string, string | undefined> };
    readonly activeElement: unknown;
    readonly querySelector: (selector: string) => Element | null;
  };
  readonly getComputedStyle: (element: Element) => { backgroundColor: string; colorScheme: string };
  readonly matchMedia: (query: string) => { readonly matches: boolean };
  readonly requestAnimationFrame: (callback: () => void) => number;
  readonly performance: { readonly getEntriesByType: (kind: string) => readonly unknown[] };
  themeMarker?: number;
  themeStart?: Record<string, unknown>;
}

const homes: string[] = [];

/** A user-data directory nobody has used: the application's first start. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-theme-'));
  homes.push(home);
  return home;
}

test.afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** Launch the built application on `home`. */
async function launch(home: string, options: LaunchOptions): Promise<Launched> {
  const application = await electron.launch({
    args: [
      '.',
      ...(options.open === undefined ? [] : [options.open]),
      `--user-data-dir=${home}`,
      ...(options.switches ?? []),
    ],
    cwd: repositoryRoot,
    colorScheme: options.emulated === undefined ? 'light' : options.emulated,
  });
  if (options.initScript !== undefined) {
    // In place before the first document, because the launch holds the
    // application's `ready` until Playwright has connected (`support/budgets.ts`).
    await application.context().addInitScript(options.initScript);
  }
  return { application, page: await application.firstWindow() };
}

/** Run `body` against a launched application, close it whatever happens, and require it gone. */
async function withApplication<T>(
  home: string,
  options: LaunchOptions,
  body: (launched: Launched) => Promise<T>,
): Promise<T> {
  const launched = await launch(home, options);
  const child = launched.application.process();
  try {
    return await body(launched);
  } finally {
    await launched.application.close();
    expect(child.exitCode === null && !child.killed).toBe(false);
  }
}

/** The control, found the way assistive technology finds it: by its role and its name. */
function control(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Theme' });
}

/** Runs in the page: its background, the scheme its root resolves, and `data-theme`. */
function readShown(): { surface: string; scheme: string; pinned: string } {
  const scope = globalThis as unknown as PageScope;
  const body = scope.document.body;
  return {
    surface: body === null ? '' : scope.getComputedStyle(body).backgroundColor,
    scheme: scope.getComputedStyle(scope.document.documentElement).colorScheme,
    pinned: scope.document.documentElement.dataset['theme'] ?? '',
  };
}

/** What the page shows. */
async function shown(page: Page): Promise<{ surface: string; scheme: string; pinned: string }> {
  return page.evaluate(readShown);
}

/** The main process's half of the scheme. */
async function native({ application }: Launched): Promise<{ source: string; dark: boolean }> {
  return application.evaluate(({ nativeTheme }) => ({
    source: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors,
  }));
}

/** Choose `choice` in the control; require the page to show `surface` at once, then the main process to follow. */
async function choose(launched: Launched, choice: Choice, surface: string): Promise<void> {
  await control(launched.page).selectOption(choice);
  expect((await shown(launched.page)).surface).toBe(surface);
  await expect.poll(async () => (await native(launched)).source).toBe(choice);
}

test('System is the first start, and follows the preference both ways', async () => {
  await withApplication(freshHome(), {}, async (launched) => {
    const { page } = launched;
    await expect(control(page)).toBeEnabled();
    await expect(control(page)).toHaveValue('system');
    expect(await control(page).locator('option').allTextContents()).toEqual([
      'Light',
      'Dark',
      'System',
    ]);
    expect(await shown(page)).toEqual({
      surface: LIGHT_SURFACE,
      scheme: 'light dark',
      pinned: 'system',
    });
    expect((await native(launched)).source).toBe('system');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await shown(page)).surface).toBe(DARK_SURFACE);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await shown(page)).surface).toBe(LIGHT_SURFACE);
  });
});

/** Runs in the page: what a theme change must leave alone. */
function readUntouched(): {
  loads: number;
  marker: unknown;
  offset: number;
  rows: number;
  scroller: string;
} {
  const scope = globalThis as unknown as PageScope;
  const scroller = scope.document.querySelector('.graph__scroll');
  return {
    loads: scope.performance.getEntriesByType('navigation').length,
    marker: scope.themeMarker,
    offset: scroller?.scrollTop ?? -1,
    rows: scope.document.querySelector('.graph__spacer')?.clientHeight ?? -1,
    scroller: scroller === null ? '' : scope.getComputedStyle(scroller).colorScheme,
  };
}

/** Runs in the page: leave a mark that a reload would wipe. */
function markDocument(): void {
  (globalThis as unknown as PageScope).themeMarker = 1;
}

test('Dark and Light override the preference at once, keeping the scroll and the page', async () => {
  test.setTimeout(SLOW_TEST_MS);
  const large = fixture('large', 'large', 10_000);
  await withApplication(freshHome(), { open: large }, async (launched) => {
    const { page } = launched;
    await expect(page.locator('.bar__path')).toHaveText(large);
    await expect(control(page)).toBeEnabled();
    await page.evaluate(markDocument);
    expect(await page.evaluate(scrollListTo, 3600)).toBe(3600);
    const before = await page.evaluate(readUntouched);
    expect(before).toMatchObject({ loads: 1, marker: 1, offset: 3600, scroller: 'light dark' });
    const canvas = (await page.evaluate(readCanvas)).rgba;

    await page.emulateMedia({ colorScheme: 'light' });
    await choose(launched, 'dark', DARK_SURFACE);
    expect(await shown(page)).toEqual({ surface: DARK_SURFACE, scheme: 'dark', pinned: 'dark' });
    expect((await native(launched)).dark).toBe(true);
    expect(await page.evaluate(readUntouched)).toEqual({ ...before, scroller: 'dark' });
    await page.waitForTimeout(300);
    expect((await page.evaluate(readCanvas)).rgba).toBe(canvas);

    await page.emulateMedia({ colorScheme: 'dark' });
    await choose(launched, 'light', LIGHT_SURFACE);
    expect(await shown(page)).toEqual({ surface: LIGHT_SURFACE, scheme: 'light', pinned: 'light' });
    expect((await native(launched)).dark).toBe(false);
    expect(await page.evaluate(readUntouched)).toEqual({ ...before, scroller: 'light' });
  });
});

/**
 * Runs in the page as an init script, before anything of the application's:
 * the preference the document starts with, and what its first rendering update
 * shows. Animation-frame callbacks run at the start of an update and its paint
 * after them, so the first one sees what the first paint draws, and no paint
 * has been recorded yet when it runs.
 */
function recordFirstFrame(): void {
  const scope = globalThis as unknown as PageScope & { gitGraphicalView?: unknown };
  const start: Record<string, unknown> = {
    dark: scope.matchMedia('(prefers-color-scheme: dark)').matches,
    beforeRenderer: scope.gitGraphicalView === undefined,
  };
  scope.themeStart = start;
  scope.requestAnimationFrame(() => {
    const body = scope.document.body;
    start['paintsBefore'] = scope.performance.getEntriesByType('paint').length;
    start['surface'] = body === null ? null : scope.getComputedStyle(body).backgroundColor;
  });
}

/** Runs in the page: what {@link recordFirstFrame} recorded. */
function readFirstFrame(): Record<string, unknown> | undefined {
  return (globalThis as unknown as PageScope).themeStart;
}

/**
 * Choose the scheme the operating system does not prefer, so that a relaunch
 * in it cannot be the operating system's preference showing through, and wait
 * until the main process has written it.
 */
async function chooseAgainstTheSystem(launched: Launched, home: string): Promise<Scheme> {
  await expect(control(launched.page)).toHaveValue('system');
  const against: Scheme = (await native(launched)).dark ? 'light' : 'dark';
  await choose(launched, against, surfaceOf(against));
  // The file is the main process's (`src/app/theme.ts`). It is read here only
  // so that closing the application cannot race the write.
  const kept = join(home, 'theme');
  await expect.poll(() => (existsSync(kept) ? readFileSync(kept, 'utf8') : '')).toContain(against);
  return against;
}

test('the choice survives a relaunch and is the scheme of the first paint', async () => {
  const home = freshHome();
  const against = await withApplication(home, { emulated: null }, (launched) =>
    chooseAgainstTheSystem(launched, home),
  );
  const options = { emulated: null, initScript: recordFirstFrame };
  await withApplication(home, options, async (launched) => {
    const { page } = launched;
    await expect(control(page)).toHaveValue(against);
    expect(await page.evaluate(readFirstFrame)).toEqual({
      dark: against === 'dark',
      beforeRenderer: true,
      paintsBefore: 0,
      surface: surfaceOf(against),
    });
    expect((await native(launched)).source).toBe(against);
    expect(await shown(page)).toMatchObject({ surface: surfaceOf(against), pinned: against });
  });
});

/** Runs in the page: whether the theme control has the focus. */
function themeHasFocus(): boolean {
  const scope = globalThis as unknown as PageScope;
  return scope.document.activeElement === scope.document.querySelector('.bar__theme');
}

test('the control is reached and operated from the keyboard alone', async () => {
  await withApplication(freshHome(), {}, async ({ page }) => {
    await expect(control(page)).toBeEnabled();
    for (let presses = 0; presses < 10 && !(await page.evaluate(themeHasFocus)); presses += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(control(page)).toBeFocused();
    await expect(control(page)).toHaveValue('system');
    await page.keyboard.press('ArrowUp');
    await expect(control(page)).toHaveValue('dark');
    expect(await shown(page)).toEqual({ surface: DARK_SURFACE, scheme: 'dark', pinned: 'dark' });
    await page.keyboard.press('ArrowUp');
    await expect(control(page)).toHaveValue('light');
    expect(await shown(page)).toEqual({ surface: LIGHT_SURFACE, scheme: 'light', pinned: 'light' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(control(page)).toHaveValue('system');
    expect(await shown(page)).toMatchObject({ surface: LIGHT_SURFACE, pinned: 'system' });
  });
});

test('the light golden image of the graph canvas holds with the window in Dark', async () => {
  const repository = fixture('branch-and-merge', 'branch-and-merge', 3);
  const options = { open: repository, switches: ['--disable-gpu'] };
  await withApplication(freshHome(), options, async (launched) => {
    const { application, page } = launched;
    await expect(page.locator('.bar__path')).toHaveText(repository);
    await choose(launched, 'dark', DARK_SURFACE);
    // The window size `golden-graph.spec.ts` takes its image at. The height the
    // canvas must reach is the golden image's own, read off its length.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(960, 600);
    });
    const golden = inflateSync(readFileSync(GOLDEN));
    const width = (await page.evaluate(readCanvas)).width;
    await expect
      .poll(async () => (await page.evaluate(readCanvas)).height)
      .toBe(golden.length / (width * 4));
    await page.waitForTimeout(300);
    const drawn = Buffer.from((await page.evaluate(readCanvas)).rgba, 'base64');
    expect((await shown(page)).surface).toBe(DARK_SURFACE);
    expect(drawn.equals(golden)).toBe(true);
  });
});
