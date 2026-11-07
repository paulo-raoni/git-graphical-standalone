import { BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';

import { CHANNELS } from '../contracts/index';
import type { UnkeptChoice } from '../contracts/index';

/** Initial window size, chosen to show a graph column and four text columns. */
const INITIAL_WIDTH = 1280;
const INITIAL_HEIGHT = 800;

/** Below this the table columns stop being usable, so the frame refuses to go. */
const MINIMUM_WIDTH = 720;
const MINIMUM_HEIGHT = 420;

/**
 * Painted where the document has not painted yet: before it loads, and in the
 * strip a resize uncovers before the page catches up. The two values are
 * `--surface` of the two schemes in `src/ui/renderer.css`, so that strip is the
 * colour of the page that is about to cover it, in either scheme.
 */
const BACKGROUND_DARK = '#1f1f1f';
const BACKGROUND_LIGHT = '#ffffff';

/** The background for the scheme in force, which `./theme.ts` set before any window. */
function backgroundColour(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND_DARK : BACKGROUND_LIGHT;
}

/**
 * Keep the window's background on the scheme in force: a choice made in the
 * window, or the operating system changing its preference while `system` is
 * chosen, both arrive as the one `updated` event.
 */
function followScheme(window: BrowserWindow): void {
  const follow = (): void => {
    window.setBackgroundColor(backgroundColour());
  };
  nativeTheme.on('updated', follow);
  window.once('closed', () => {
    nativeTheme.off('updated', follow);
  });
}

/** The kinds of choice already said to be unkept in this run of the application. */
const unkeptSaid = new Set<string>();

/**
 * Say in the window that a choice could not be kept for the next start: `what`
 * names the choice ("theme choice"), `file` the file that could not be written.
 *
 * Sent to the window as the one message the main process pushes
 * (`CHANNELS.unkeptChoice`), and shown there as a notice inside the window that
 * blocks nothing (`showUnkept`, `src/ui/shell.ts`), because a person who did not
 * start the application from a terminal never reads the standard error the
 * caller also writes to. Not a message box: S03's box was modal and blocked the
 * owner's screen until dismissed (the owner's report of 2026-11-04). **Each kind
 * is said once per run**: a disk that refuses one write refuses the next. With
 * no window to send to, it is said on the standard error alone, and the kind is
 * not counted as said.
 */
export function sayUnkept(what: string, file: string): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  // The line "once per run" hinges on.
  if (unkeptSaid.has(what) || window === undefined) {
    return;
  }
  unkeptSaid.add(what);
  const unkept: UnkeptChoice = { what, file };
  window.webContents.send(CHANNELS.unkeptChoice, unkept);
}

/**
 * Refuse every navigation and every attempt to open a second window.
 *
 * The renderer only ever loads one local document. Anything that tries to
 * navigate it, or to open a window from it, is either a defect or an attack, and
 * in both cases the right answer is to do nothing and hand the URL to the
 * user's browser instead.
 */
function refuseNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/**
 * Create the application's window.
 *
 * The `webPreferences` below are the line this whole slice's guarantee hangs
 * on: a window configured wrongly compiles, builds and opens exactly like a
 * correct one, and the difference only shows up as `window.require` being a
 * function in a page that should never have had one.
 *
 * Background throttling is deliberately left on. A hidden window that keeps
 * running is what makes a desktop application expensive on a laptop.
 *
 * @param distDirectory absolute path of the built output the window loads from
 * @returns the created window
 */
export function createMainWindow(distDirectory: string): BrowserWindow {
  const window = new BrowserWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: MINIMUM_WIDTH,
    minHeight: MINIMUM_HEIGHT,
    backgroundColor: backgroundColour(),
    show: false,
    webPreferences: {
      preload: join(distDirectory, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });

  refuseNavigation(window);
  followScheme(window);
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadFile(join(distDirectory, 'index.html'));
  return window;
}
