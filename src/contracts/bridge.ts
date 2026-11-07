import type { DetailsRequest, DetailsResponse } from './commit-details';
import type {
  ApplicationInfoResponse,
  ChooseFolderResponse,
  LoadMoreCommitsRequest,
  LoadMoreCommitsResponse,
  OpenRepositoryRequest,
  OpenRepositoryResponse,
  RefreshRequest,
  RefreshResponse,
  StartupRepositoryResponse,
} from './ipc';
import type { ChooseThemeRequest, ChooseThemeResponse, ThemeChoiceResponse } from './ipc';
import type { UnkeptChoice } from './ipc';

/** The property the preload attaches the bridge to on the renderer's global. */
export const BRIDGE_GLOBAL_NAME = 'gitGraphical';

/**
 * The only surface the renderer has on the rest of the application.
 *
 * It is a fixed set of methods, one per channel, and not a generic `invoke`
 * that takes a channel name: a generic one would let anything running in the
 * page reach a channel the renderer was never meant to use, which is the whole
 * reason the bridge exists. Adding a capability here is a change to this file
 * and to the preload, and therefore visible in review.
 *
 * Every method that asks resolves to a `Result`. None of them rejects on a
 * failure the user could be told about; a rejection here means the bridge itself
 * is broken. One method does not ask: {@link GitGraphicalBridge.unkeptChoice}
 * subscribes to the one message the main process sends unasked.
 */
export interface GitGraphicalBridge {
  /** Report the folder the application was started with, if it was given one. */
  readonly startupRepository: () => Promise<StartupRepositoryResponse>;
  /** Open a repository by absolute path, on the branch selection kept for it. */
  readonly openRepository: (request: OpenRepositoryRequest) => Promise<OpenRepositoryResponse>;
  /** Show the folder chooser and report what the user picked. */
  readonly chooseFolder: () => Promise<ChooseFolderResponse>;
  /** Append more commits to the open repository's page. */
  readonly loadMoreCommits: (request: LoadMoreCommitsRequest) => Promise<LoadMoreCommitsResponse>;
  /**
   * Re-read the open repository from disk under the branch selection in force,
   * or apply the selection the request carries and answer its first page.
   */
  readonly refresh: (request: RefreshRequest) => Promise<RefreshResponse>;
  /**
   * Read the details of one commit of the open repository, named by its full
   * object name, or of its uncommitted changes, from git, at each call.
   */
  readonly commitDetails: (request: DetailsRequest) => Promise<DetailsResponse>;
  /** Report the application's own versions. */
  readonly applicationInfo: () => Promise<ApplicationInfoResponse>;
  /** Report the colour scheme in force. */
  readonly themeChoice: () => Promise<ThemeChoiceResponse>;
  /** Apply a colour scheme to the whole application and keep it for the next start. */
  readonly chooseTheme: (request: ChooseThemeRequest) => Promise<ChooseThemeResponse>;
  /**
   * Call `listener` each time the main process says a choice could not be kept
   * for the next start. It is handed the two strings of the message, checked,
   * and never the message itself; a message that is not one is dropped.
   */
  readonly unkeptChoice: (listener: (unkept: UnkeptChoice) => void) => void;
}

declare global {
  interface Window {
    /**
     * The bridge the preload exposed. Present in every window this application
     * creates; absent in any other context, which is why the renderer must not
     * assume it when running outside the shell.
     */
    readonly gitGraphical: GitGraphicalBridge;
  }
}
