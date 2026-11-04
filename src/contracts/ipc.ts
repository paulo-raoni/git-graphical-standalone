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
export const CHANNELS = /* @__PURE__ */ Object.freeze({
  /** Report the folder the application was started with, if it was given one. */
  startupRepository: 'repository:startup',
  /** Open a repository at a known path and return its first page, under the selection kept for it. */
  openRepository: 'repository:open',
  /** Ask the main process to show a folder chooser. */
  chooseFolder: 'repository:choose-folder',
  /** Append the next block of commits to the open repository's page. */
  loadMoreCommits: 'repository:load-more-commits',
  /** Re-read the open repository, or apply a branch selection, and return the page. */
  refresh: 'repository:refresh',
  /** Report the application's own versions. Reads no repository. */
  applicationInfo: 'application:info',
  /** Report the colour scheme in force. Reads no repository. */
  themeChoice: 'theme:choice',
  /** Apply a colour scheme to the application and keep it for the next start. */
  chooseTheme: 'theme:choose',
} as const);

/** One of the channel names in {@link CHANNELS}. */
export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * The repository the application was started with.
 *
 * It is a reply rather than a push, because the renderer is what decides when it
 * is ready to draw one and a message sent before the document loads is a message
 * nobody received. `path` is `null` when the application was started with no
 * folder, which is the empty state and not a failure.
 */
export interface StartupRepository {
  /** An absolute path, or `null` when no folder was named on the command line. */
  readonly path: string | null;
}

/** The startup folder, or why it could not be reported. */
export type StartupRepositoryResponse = Result<StartupRepository>;

/**
 * Which branches a page shows, and whether remote-tracking branches are shown at
 * all.
 *
 * - `branches: null` is **every branch**: every local branch, every
 *   remote-tracking branch while they are shown, every tag, and HEAD. It is what
 *   a repository with nothing kept opens on, and what the window showed before a
 *   selection existed.
 * - `branches: [...]` is **the union of the histories of the branches named**,
 *   and nothing else: no tag, no HEAD, no branch that is not named. Each name is
 *   a full reference name as git spells it, `refs/heads/<branch>` for a local
 *   branch and `refs/remotes/<remote>/<branch>` for a remote-tracking one — the
 *   prefix is what tells a local branch called `origin/main` from the
 *   remote-tracking `origin/main`, and what keeps a tag of the same name from
 *   being read instead. A name with neither prefix is not read, and neither is
 *   one that git's ref-name rules refuse (those of `git check-ref-format`): a
 *   prefix alone let `refs/heads/side..HEAD` and `refs/heads/side...refs/stash`
 *   through, which git reads as ranges, taking in HEAD's and the stash's commits
 *   (E03-M01's review round 04 measured both; the fixtures suite of
 *   `src/adapters/` holds both refused, by E04-M01-S02). A name git does
 *   not resolve, such as a branch deleted since it was chosen, is skipped, and a
 *   list whose every name is skipped reads no commit at all. An empty list reads
 *   no commit either; it is not a second spelling of every branch.
 * - `showRemoteBranches: false` reads no remote-tracking branch and labels no
 *   commit with one, whatever `branches` names; local branches and tags stay.
 *
 * Every reference that is read still labels the commits it points at, so a
 * branch that is not selected keeps its label on a commit a selected one reaches.
 */
export interface BranchSelection {
  /** Full reference names of the branches shown, or `null` for every branch. */
  readonly branches: readonly string[] | null;
  /** Whether remote-tracking branches are read and labelled. */
  readonly showRemoteBranches: boolean;
}

/**
 * Open the repository rooted at, or containing, `path`.
 *
 * A repository opens on the selection last applied to it — by `path`, as it is
 * spelled — which the main process keeps across restarts and between instances
 * on one user-data directory, and on every branch with remote-tracking branches
 * shown when nothing is kept. The reply says which selection that was. Refresh
 * and Load More keep it, as they keep any selection applied later, and every
 * selection a Refresh applies is kept for the repository in its place.
 *
 * A kept selection is read as it was kept, so it can name a branch the
 * repository no longer has; `survivingSelection` says which of its branches
 * remain, and a Refresh applying that is how a caller drops the rest.
 */
export interface OpenRepositoryRequest {
  /** An absolute path to a working tree or to a directory inside one. */
  readonly path: string;
  /**
   * Absent, the open reads under what is kept. Present, it opens on every
   * branch with remote-tracking branches shown or not as this says, and what is
   * kept is neither read nor changed by the open.
   */
  readonly showRemoteBranches?: boolean;
}

/** An opened repository's first page, and the selection it was read under. */
export interface OpenedPage extends GraphPage {
  /**
   * The selection the page was read under, and the one Refresh and Load More now
   * keep: the one kept for the repository, or every branch.
   */
  readonly selection: BranchSelection;
}

/** The first page, or why the repository could not be opened. */
export type OpenRepositoryResponse = Result<OpenedPage>;

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

/**
 * Re-read the open repository from disk, under the selection last applied — or,
 * with `selection`, apply that selection and read its first page.
 *
 * Without `selection` it re-reads as many commits as are loaded, under the
 * selection the repository was opened or last refreshed with. With it, the
 * selection replaces that one for every later Refresh and Load More, and the
 * reply is a first page under it, laid out from nothing. A reply read under a
 * selection that was replaced while it was being read is dropped, answered as a
 * `FailureKind.Cancelled` failure, so the window ends on the selection asked
 * for last.
 */
export interface RefreshRequest {
  /** The selection to apply, or absent to keep the one in force. */
  readonly selection?: BranchSelection;
}

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

/**
 * The colour schemes a person can choose. `System` follows the operating
 * system's light or dark preference, including when it changes while the window
 * is open, and is what the application starts on until a person chooses.
 *
 * The choice belongs to the application, not to a repository: opening another
 * repository keeps it, and the main process keeps it across restarts.
 */
export const ThemeChoice = /* @__PURE__ */ Object.freeze({
  /** The light scheme, whatever the operating system prefers. */
  Light: 'light',
  /** The dark scheme, whatever the operating system prefers. */
  Dark: 'dark',
  /** Whichever of the two the operating system prefers. */
  System: 'system',
} as const);

/** One of the values of {@link ThemeChoice}. */
export type ThemeChoice = (typeof ThemeChoice)[keyof typeof ThemeChoice];

/** The colour scheme in force. */
export interface ThemeSetting {
  /** What the person chose, or `system` when they never chose. */
  readonly choice: ThemeChoice;
}

/** The colour scheme in force. */
export type ThemeChoiceResponse = Result<ThemeSetting>;

/** Apply `choice` to the whole application, and keep it for the next start. */
export interface ChooseThemeRequest {
  /** The scheme to apply. A value outside {@link ThemeChoice} changes nothing. */
  readonly choice: ThemeChoice;
}

/**
 * The colour scheme in force after the request: the one asked for, or the one
 * that stayed when the request named none of the three.
 */
export type ChooseThemeResponse = Result<ThemeSetting>;
