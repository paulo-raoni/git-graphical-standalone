import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { createMainWindow } from './window';

/**
 * The composition root.
 *
 * It owns the process lifecycle and nothing else. There is no rule here, no
 * parsing and no view: later slices add the adapters and the IPC handlers, and
 * they are built and injected from this file rather than reached for from
 * inside the rings.
 *
 * The built output is the application's own directory plus `dist`, which is
 * where the bundler puts the preload, the document and the renderer. Resolving
 * it from `app.getAppPath()` rather than from the bundle's own location keeps
 * working once the application is packaged into an archive.
 */
function distDirectory(): string {
  return join(app.getAppPath(), 'dist');
}

function openWindow(): void {
  createMainWindow(distDirectory());
}

function start(): void {
  openWindow();

  // macOS keeps the application running with no window, and reopens one when the
  // dock icon is clicked. Windows and Linux have no such state.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void app.whenReady().then(start);
