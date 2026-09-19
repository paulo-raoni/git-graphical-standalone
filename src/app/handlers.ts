import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { CHANNELS, FailureKind } from '../contracts/index';
import type {
  ApplicationInfoResponse,
  ChooseFolderResponse,
  GraphPage,
  LoadMoreCommitsRequest,
  OpenRepositoryRequest,
  Result,
  StartupRepositoryResponse,
} from '../contracts/index';
import type { ReaderDescription } from '../ports/index';

import type { RepositoryClient } from './repository-client';

/**
 * Every channel of `src/contracts/ipc.ts`, answered.
 *
 * This is the whole of what the main process does with a repository: it
 * forwards. Four of the six channels are a message to the utility process and
 * its answer handed back unchanged; one is a folder dialog, which only a process
 * that owns a window can show; and one is a string read off the command line at
 * startup. No git process is started here, nothing is parsed here, and nothing
 * here waits on anything but another process's reply, which is what
 * `docs/ADR-0002-architecture-and-performance.md` decision 2 requires of the
 * process that owns the window.
 *
 * The handlers are registered once, for the application rather than for a
 * window, because `ipcMain.handle` is keyed by channel and a second registration
 * of the same channel throws. The dialog therefore takes the window it should be
 * modal to as an argument rather than closing over one.
 */

/** What the folder chooser says at the top, and what its accept button reads. */
const CHOOSER_TITLE = 'Open Repository';
const CHOOSER_BUTTON = 'Open';

/** What the renderer is told when the user dismissed the chooser. */
const DISMISSED = 'No folder was chosen.';

/** Everything the handlers need from the rest of the composition root. */
export interface HandlerContext {
  /** The seam to the process that reads repositories. */
  readonly client: RepositoryClient;
  /** The folder named on the command line, already absolute, or `null`. */
  readonly startupPath: string | null;
  /** The window a modal dialog belongs to, looked up when one is shown. */
  readonly windowOf: () => BrowserWindow | null;
}

/** Show the folder chooser and report what the user picked. */
async function chooseFolder(context: HandlerContext): Promise<ChooseFolderResponse> {
  const parent = context.windowOf();
  const options = {
    title: CHOOSER_TITLE,
    buttonLabel: CHOOSER_BUTTON,
    properties: ['openDirectory' as const],
  };
  const chosen =
    parent === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);
  const path = chosen.filePaths[0];
  if (chosen.canceled || path === undefined) {
    return { ok: false, kind: FailureKind.Cancelled, message: DISMISSED };
  }
  return { ok: true, value: { path } };
}

/**
 * The versions this application is built on, including git's.
 *
 * git's is asked of the utility process, because that is where discovery lives
 * and the main process may not run git itself. A missing git is reported as
 * `null` rather than as a failure, which `src/contracts/ipc.ts` fixes as the
 * invariant of this reply: the window has to be able to say what it is running
 * on even when git is absent.
 */
async function applicationInfo(context: HandlerContext): Promise<ApplicationInfoResponse> {
  const described = await context.client.ask<ReaderDescription>({ kind: 'describe' });
  return {
    ok: true,
    value: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      git: described.ok ? described.value.version : null,
    },
  };
}

/** Register every channel. Called once, before the first window is created. */
export function registerHandlers(context: HandlerContext): void {
  ipcMain.handle(CHANNELS.startupRepository, (): StartupRepositoryResponse => {
    return { ok: true, value: { path: context.startupPath } };
  });

  ipcMain.handle(
    CHANNELS.openRepository,
    (_event: unknown, request: OpenRepositoryRequest): Promise<Result<GraphPage>> =>
      context.client.ask<GraphPage>({ kind: 'open', path: request.path }),
  );

  ipcMain.handle(CHANNELS.chooseFolder, (): Promise<ChooseFolderResponse> => chooseFolder(context));

  ipcMain.handle(
    CHANNELS.loadMoreCommits,
    (_event: unknown, request: LoadMoreCommitsRequest): Promise<Result<GraphPage>> =>
      context.client.ask<GraphPage>({ kind: 'load-more', count: request.count }),
  );

  ipcMain.handle(CHANNELS.refresh, (): Promise<Result<GraphPage>> =>
    context.client.ask<GraphPage>({ kind: 'refresh' }),
  );

  ipcMain.handle(CHANNELS.applicationInfo, (): Promise<ApplicationInfoResponse> =>
    applicationInfo(context),
  );
}
