import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { CHANNELS, FailureKind, keptSelection, openingSelection } from '../contracts/index';
import type {
  ApplicationInfoResponse,
  ChooseFolderResponse,
  ChooseThemeRequest,
  ChooseThemeResponse,
  GraphPage,
  LoadMoreCommitsRequest,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  Result,
  StartupRepositoryResponse,
  ThemeChoiceResponse,
} from '../contracts/index';
import type { ReaderDescription } from '../ports/index';

import type { RepositoryClient } from './repository-client';
import type { SelectionStore } from './selections';
import type { ThemeStore } from './theme';

/**
 * Every channel of `src/contracts/ipc.ts`, answered.
 *
 * This is the whole of what the main process does with a repository: it
 * forwards. Four of the eight channels are a message to the utility process and
 * its answer handed back unchanged; one is a folder dialog, which only a process
 * that owns a window can show; one is a string read off the command line at
 * startup; and two read and set the colour scheme, which is the application's
 * and not a repository's (`./theme.ts`). No git process is started here, nothing
 * is parsed here, and nothing here waits on anything but another process's reply
 * or the write of a few bytes of settings, which is what
 * `docs/ADR-0002-architecture-and-performance.md` decision 2 requires of the
 * process that owns the window.
 *
 * A refresh is forwarded **whole**, the request spread into the question with its
 * `kind` written over it, rather than field by field: the branch selection it can
 * carry is the utility process's to read (`./repository-host.ts`).
 *
 * **The branch selection kept per repository** is this process's
 * (`./selections.ts`), because it is the one process every instance's windows
 * share nothing with but the disk. An open reads the record for its path, asks
 * for the page under it, and answers the page with the selection it was read
 * under; a refresh that applied a selection keeps that selection for the
 * repository last opened, once the utility process has answered it with a page,
 * so a selection overtaken by another is never kept. Which selection an open
 * reads under and whether a record is one are decided by
 * `src/contracts/kept-selection.ts`; nothing here decides them. Which kept
 * branches the repository still has is decided there too, and asked by the
 * renderer, which already reads the page's references for its list.
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
  /** The colour scheme in force, already applied before the window was created. */
  readonly theme: ThemeStore;
  /** The branch selection kept for each repository. */
  readonly selections: SelectionStore;
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

/** Register the channels that open and read a repository. */
function registerRepositoryHandlers(context: HandlerContext): void {
  /**
   * The path of the repository opened last, which a selection a Refresh applies
   * is kept for. Set only by an open that answered a page, which the utility
   * process answers only once that repository is the one it has open.
   */
  let opened = '';

  ipcMain.handle(
    CHANNELS.openRepository,
    async (_event: unknown, request: OpenRepositoryRequest): Promise<OpenRepositoryResponse> => {
      const { path } = request;
      const kept = await context.selections.read(path);
      const selection = openingSelection(kept, request.showRemoteBranches);
      const reply = await context.client.ask<GraphPage>({ kind: 'open', path, selection });
      if (!reply.ok) {
        return reply;
      }
      opened = path;
      return { ok: true, value: { ...reply.value, selection } };
    },
  );

  ipcMain.handle(CHANNELS.chooseFolder, (): Promise<ChooseFolderResponse> => chooseFolder(context));

  ipcMain.handle(
    CHANNELS.loadMoreCommits,
    (_event: unknown, request: LoadMoreCommitsRequest): Promise<Result<GraphPage>> =>
      context.client.ask<GraphPage>({ kind: 'load-more', count: request.count }),
  );

  ipcMain.handle(
    CHANNELS.refresh,
    async (_event: unknown, request: RefreshRequest): Promise<Result<GraphPage>> => {
      const reply = await context.client.ask<GraphPage>({ ...request, kind: 'refresh' });
      // Checked before it is written, because it came from the page.
      const selection = keptSelection(request.selection);
      if (reply.ok && selection !== null) {
        // Awaited, so the page under a selection is drawn only once the
        // selection is on the disk for the next open, in any instance.
        await context.selections.keep(opened, selection);
      }
      return reply;
    },
  );
}

/** Register every channel. Called once, before the first window is created. */
export function registerHandlers(context: HandlerContext): void {
  ipcMain.handle(CHANNELS.startupRepository, (): StartupRepositoryResponse => {
    return { ok: true, value: { path: context.startupPath } };
  });

  registerRepositoryHandlers(context);

  ipcMain.handle(CHANNELS.applicationInfo, (): Promise<ApplicationInfoResponse> =>
    applicationInfo(context),
  );

  ipcMain.handle(CHANNELS.themeChoice, (): ThemeChoiceResponse => {
    return { ok: true, value: { choice: context.theme.current() } };
  });

  ipcMain.handle(
    CHANNELS.chooseTheme,
    async (
      _event: unknown,
      request: ChooseThemeRequest | undefined,
    ): Promise<ChooseThemeResponse> => {
      const choice = await context.theme.choose(request?.choice);
      return { ok: true, value: { choice } };
    },
  );
}
