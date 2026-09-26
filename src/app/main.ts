import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { registerHandlers } from './handlers';
import { createRepositoryClient } from './repository-client';
import type { RepositoryClient } from './repository-client';
import { startupRepositoryPath } from './startup';
import { createMainWindow } from './window';

/**
 * The composition root.
 *
 * It owns the process lifecycle, builds the two things the application is made
 * of — a window and a client of the process that reads repositories — and wires
 * the channels between them. There is no rule here: nothing in this file parses
 * git's output, decides what a page is or knows which lane a commit is in
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1).
 *
 * The built output is the application's own directory plus `dist`, which is
 * where the bundler puts the preload, the document, the renderer and the utility
 * process. Resolving it from `app.getAppPath()` rather than from the bundle's
 * own location keeps working once the application is packaged into an archive.
 */
function distDirectory(): string {
  return join(app.getAppPath(), 'dist');
}

/**
 * The client, built when the application is ready rather than at module scope,
 * so that nothing asks Electron where the application lives before it knows.
 */
let client: RepositoryClient | null = null;

function openWindow(): void {
  createMainWindow(distDirectory());
}

function start(): void {
  client = createRepositoryClient(distDirectory());
  registerHandlers({
    client,
    startupPath: startupRepositoryPath(process.argv, app.isPackaged),
    windowOf: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  });
  openWindow();

  // macOS keeps the application running with no window, and reopens one when the
  // dock icon is clicked. Windows and Linux have no such state.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow();
    }
  });
}

/**
 * The utility process is stopped with the last window, and again before the
 * application quits.
 *
 * Twice, because the two events are not the same one and neither implies the
 * other: on macOS the last window closing does not quit the application, and a
 * quit from the menu does not necessarily close a window first. A utility
 * process that outlives its window is this slice's characteristic leak, and
 * ending it is also how its memory is returned to the operating system rather
 * than waited for (decision 2). `stop` is safe to call twice and the next
 * request starts a new process, so nothing is lost by being early.
 */
app.on('window-all-closed', () => {
  client?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  client?.stop();
});

void app.whenReady().then(start);
