import type { GraphPage } from './graph-page';
import type { Result } from './result';

/**
 * Every channel that crosses the process boundary, and the only place a channel
 * name is spelled. No string literal channel name appears anywhere else in the
 * codebase: the preload's allow-list, the main process's handlers and any test
 * all read these constants, so a typo cannot silently open a second channel.
 *
 * Frozen at runtime as well as at the type level, because the object is handed
 * to the preload, which runs beside untrusted page content.
 */
export const CHANNELS = Object.freeze({
  /** Open a repository at a known path and return its first page. */
  openRepository: 'repository:open',
  /** Ask the main process to show a folder chooser. */
  chooseFolder: 'repository:choose-folder',
  /** Append the next block of commits to the open repository's page. */
  loadMoreCommits: 'repository:load-more-commits',
  /** Re-read the open repository and return the page again. */
  refresh: 'repository:refresh',
  /** Report the application's own versions. Reads no repository. */
  applicationInfo: 'application:info',
} as const);

/** One of the channel names in {@link CHANNELS}. */
export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Open the repository rooted at, or containing, `path`. */
export interface OpenRepositoryRequest {
  /** An absolute path to a working tree or to a directory inside one. */
  readonly path: string;
}

/** The first page, or why the repository could not be opened. */
export type OpenRepositoryResponse = Result<GraphPage>;

/** The folder the user picked. */
export interface ChosenFolder {
  /** Absolute path of the chosen directory. */
  readonly path: string;
}

/**
 * The chosen folder, or a {@link FailureKind} of `cancelled` when the user
 * dismissed the dialog. Dismissal is an outcome, not an exception.
 */
export type ChooseFolderResponse = Result<ChosenFolder>;

/** Append at most `count` more commits to the open repository's page. */
export interface LoadMoreCommitsRequest {
  /** How many further commits to load. The producer may return fewer. */
  readonly count: number;
}

/** The whole page again, grown. Not a delta; see {@link GraphPage}. */
export type LoadMoreCommitsResponse = Result<GraphPage>;

/** Re-read the open repository from disk. Carries no argument yet. */
export type RefreshRequest = Record<string, never>;

/** The whole page again, re-read. */
export type RefreshResponse = Result<GraphPage>;

/**
 * The versions the application is built on, for an about box and for bug
 * reports.
 *
 * Invariant: `git` is `null` until the git adapter has discovered an executable.
 * A missing git is reported here as `null` rather than as a failure, because the
 * window has to be able to say what it is running on even when git is absent.
 */
export interface ApplicationInfo {
  /** The product's display name. */
  readonly name: string;
  /** The product's own version. */
  readonly version: string;
  /** The Electron version the shell is running. */
  readonly electron: string;
  /** The Chromium version the renderer is running. */
  readonly chromium: string;
  /** The Node version the main process is running. */
  readonly node: string;
  /** The discovered git version, or `null` when git has not been found. */
  readonly git: string | null;
}

/** The application's versions. */
export type ApplicationInfoResponse = Result<ApplicationInfo>;
