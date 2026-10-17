import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

/** Initial window size, chosen to show a graph column and four text columns. */
const INITIAL_WIDTH = 1280;
const INITIAL_HEIGHT = 800;

/** Below this the table columns stop being usable, so the frame refuses to go. */
const MINIMUM_WIDTH = 720;
const MINIMUM_HEIGHT = 420;

/** Painted before the document loads, so the frame never flashes white. */
const BACKGROUND_COLOUR = '#1f1f1f';

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
    backgroundColor: BACKGROUND_COLOUR,
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
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadFile(join(distDirectory, 'index.html'));
  return window;
}
