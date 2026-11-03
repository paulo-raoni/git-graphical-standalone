import {
  branchEntries,
  BRIDGE_GLOBAL_NAME,
  FailureKind,
  menuOf,
  pressShowAll,
  sameSelection,
  selectionOf,
  SHOW_ALL,
  showingRemotes,
  survivingSelection,
  ThemeChoice,
  toggleBranch,
} from '../contracts/index';
import type { BranchEntry, BranchMenu, Failure, GraphPage, Refs, Result } from '../contracts/index';

import { mountGraphTable } from './graph-table';
import type { GraphTableView } from './graph-table';
import { mountShell, OPEN_LABEL, REFRESH_LABEL } from './shell';
import type { Shell } from './shell';

/**
 * The renderer's entry point: assert the window was built correctly, mount the
 * shell and the table, and connect them to the preload bridge.
 *
 * **It still holds no rule.** Nothing here decides which lane a commit is in,
 * what a page contains or which row HEAD is: it asks over the bridge, hands the
 * answer to the view, and shows a failure when there is one. The one number it
 * names is the size of a further page, and the paragraph on
 * {@link LOAD_MORE_COMMITS} says why that is unavoidable and what stops it
 * drifting.
 *
 * Nothing polls and nothing waits on a timer. Every request starts from an event
 * — the document loading, a click, or the view's Load More intent — and the
 * control that started one is disabled until it is answered.
 *
 * **It keeps nothing across a restart.** The branch selection and Show Remote
 * Branches of each repository are kept by the main process (`src/app/selections.ts`),
 * which opens a repository on them and says in the open's reply which they were.
 */

/** Where the view is published on the window's global. */
const VIEW_GLOBAL_NAME = 'gitGraphicalView';

/**
 * How many more commits one press of Load More asks for.
 *
 * **This number is written twice and that is not an oversight.**
 * `src/core/page/page-sizes.ts` is where the page sizes are decided and argued;
 * `LoadMoreCommitsRequest.count` is a field of the request the *renderer* sends
 * (`src/contracts/ipc.ts`), and `ui-only-contracts` in `.dependency-cruiser.cjs`
 * lets this ring name `src/contracts/` and nothing else — so the renderer cannot
 * import the constant it has to send, and weakening that rule to let it would be
 * opening `src/core/` to the renderer for the sake of one integer.
 *
 * What keeps the two from drifting is a gate rather than this comment:
 * `test/e2e/open-repository.spec.ts` imports both and requires them to be the
 * same number, which is the same instrument the project uses everywhere else a
 * convention would otherwise have to be trusted.
 */
const LOAD_MORE_COMMITS = 300;

/**
 * What the bar's controls say at rest, and while the request they started is
 * running. The resting spellings are `./shell.ts`'s, which builds the controls.
 */
const OPEN_LABELS: Labels = { resting: OPEN_LABEL, busy: 'Opening…' };
const REFRESH_LABELS: Labels = { resting: REFRESH_LABEL, busy: 'Refreshing…' };

/**
 * The view, as everything outside this ring sees it.
 *
 * **Why it is on a global at all.** This module composes the application
 * in-process and imports `mountGraphTable` directly; it does not need this. The
 * end-to-end gate does. `src/ui/renderer.ts` is a bundle entry point that runs
 * at module scope, so without a published handle there is no seam for a driver
 * to hand the view a page — and the alternative, a second bundle entry holding
 * fixtures, would ship test data in the distributable and would need a size
 * budget of its own. One named property costs the bundle a few bytes and keeps
 * the fixtures in `test/e2e/`, where the driver builds them and this ring never
 * sees them.
 */
export interface GraphTableGlobal {
  /** Mount a table into an element. */
  readonly mount: (root: HTMLElement) => GraphTableView;
  /** Hand the mounted view a page to draw. */
  readonly showPage: (page: GraphPage) => void;
  /** Register the listener the Load More Commits control calls. */
  readonly onLoadMore: (listener: () => void) => void;
}

declare global {
  interface Window {
    /**
     * The mounted view. Present in every window this renderer starts; absent
     * anywhere else, which is why nothing may assume it.
     */
    gitGraphicalView?: GraphTableGlobal;
  }
}

/**
 * Fail loudly when the preload did not run.
 *
 * A window created without the bridge looks identical to a correct one until
 * something tries to use it. Checking at startup turns a silent
 * misconfiguration of `webPreferences` into an error in the console of the very
 * window that has it.
 */
function assertBridgeIsPresent(): void {
  if (!(BRIDGE_GLOBAL_NAME in window)) {
    throw new Error(
      `The preload bridge "${BRIDGE_GLOBAL_NAME}" is missing: this window was created without it.`,
    );
  }
}

/**
 * What the window is looking at, and which of its controls are waiting for an
 * answer, which is the whole of the renderer's state.
 */
interface Session {
  path: string | null;
  /** The bar's controls whose own request is unanswered. */
  readonly busy: Set<HTMLButtonElement>;
  /** The references of the page drawn last, which the Branches list is made from. */
  refs: Refs | null;
  /** What the Branches list has checked, and the entries it offers. */
  menu: BranchMenu;
  entries: readonly BranchEntry[];
  /** Whether Show Remote Branches is checked. */
  showRemoteBranches: boolean;
}

/** What a bar control says at rest, and while the request it started runs. */
interface Labels {
  readonly resting: string;
  readonly busy: string;
}

/**
 * Run `work` with `button` disabled and saying what it is doing, until its own
 * request is answered.
 *
 * The resting label is passed in, not read off the element: the element shows
 * whatever it was last given, and a label read while it said `busy` would be put
 * back as the resting one for good. `finally` is what makes a failed request
 * leave a usable control behind rather than a dead one.
 */
async function whileBusy(
  session: Session,
  button: HTMLButtonElement,
  labels: Labels,
  work: () => Promise<void>,
): Promise<void> {
  session.busy.add(button);
  button.disabled = true;
  button.textContent = labels.busy;
  try {
    await work();
  } finally {
    session.busy.delete(button);
    button.disabled = false;
    button.textContent = labels.resting;
  }
}

/**
 * Draw a reply, or show why there is not one.
 *
 * `opened` is which request this answers, and nothing more: an Open's page is
 * drawn from its first row, a Refresh's or a Load More's at the offset the table
 * already has. The renderer knows which request it made; what each kind of page
 * does to the offset is the view's.
 */
function receive(
  shell: Shell,
  view: GraphTableView,
  session: Session,
  reply: Result<GraphPage>,
  opened = false,
): void {
  if (!reply.ok) {
    report(shell, reply);
    return;
  }
  shell.clearFailure();
  shell.showPath(session.path);
  session.refs = reply.value.refs;
  showBranches(shell, session);
  shell.branches.enable();
  // A repository is shown, so Refresh is usable, unless a Refresh is still
  // reading: this may be another request's reply, and only its own answers it.
  shell.refresh.disabled = session.busy.has(shell.refresh);
  if (opened) {
    view.showOpenedPage(reply.value);
  } else {
    view.showPage(reply.value);
  }
}

/**
 * Show a failure, except a cancellation.
 *
 * A dismissed folder chooser is an outcome and not an error
 * (`src/contracts/result.ts`), so it leaves the window exactly as it was.
 */
function report(shell: Shell, failure: Failure): void {
  if (failure.kind !== FailureKind.Cancelled) {
    shell.showFailure(failure);
  }
}

/**
 * Let a rejection reach the window instead of the void.
 *
 * The bridge resolves every failure the user could be told about as a value, so
 * a rejection means the bridge itself is broken — which is still something the
 * window has to be able to say, and an unhandled rejection says it only to a
 * console nobody has open.
 */
function run(shell: Shell, work: Promise<void>): void {
  void work.catch((error: unknown) => {
    shell.showFailure({
      ok: false,
      kind: FailureKind.GitFailed,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

/** Hand the Branches control the entries of the last page and what is checked. */
function showBranches(shell: Shell, session: Session): void {
  session.entries =
    session.refs === null ? [] : branchEntries(session.refs, session.showRemoteBranches);
  shell.branches.show(session.entries, session.menu);
}

/**
 * Open `path` on the branch selection and Show Remote Branches last applied to
 * it, which the main process keeps and opens it on, less every kept branch the
 * repository no longer has.
 *
 * The open's reply says which selection its page was read under. When a branch
 * it names is gone (`survivingSelection`), that page is not drawn: what survives
 * is applied, as a click would apply it, and its page is the first one drawn —
 * every branch, when nothing survives, so a stale selection never shows an empty
 * graph. Applying it is also what keeps it for the next open in place of the
 * stale one, and what leaves the utility process reading only branches the
 * control shows.
 *
 * The control is given the selection in the same task as the page, before either
 * is drawn, so no page under another selection is ever drawn first.
 */
async function open(
  shell: Shell,
  view: GraphTableView,
  session: Session,
  path: string,
): Promise<void> {
  const opened = await window.gitGraphical.openRepository({ path });
  let reply: Result<GraphPage> = opened;
  if (opened.ok) {
    const { selection, refs } = opened.value;
    const shown = survivingSelection(selection, refs);
    session.path = path;
    session.menu = menuOf(shown);
    session.showRemoteBranches = shown.showRemoteBranches;
    if (!sameSelection(shown, selection)) {
      reply = await window.gitGraphical.refresh({ selection: shown });
    }
    // Indeterminate until here, because nothing had said what this repository keeps.
    shell.branches.remotes.indeterminate = false;
    shell.branches.remotes.checked = shown.showRemoteBranches;
  }
  receive(shell, view, session, reply, true);
}

/**
 * Show what the Branches control now has checked at once, and ask for its page
 * when that is a different page from the one asked for before. The page is drawn
 * from its first row: it is a first page laid out from nothing, and the offset
 * the table had belongs to rows it may not hold.
 */
function choose(
  shell: Shell,
  view: GraphTableView,
  session: Session,
  menu: BranchMenu,
  showRemoteBranches = session.showRemoteBranches,
): void {
  const before = selectionOf(session.menu, session.showRemoteBranches);
  const selection = selectionOf(menu, showRemoteBranches);
  session.menu = menu;
  session.showRemoteBranches = showRemoteBranches;
  showBranches(shell, session);
  if (sameSelection(before, selection)) {
    return;
  }
  run(
    shell,
    (async (): Promise<void> => {
      const reply = await window.gitGraphical.refresh({ selection });
      receive(shell, view, session, reply, true);
    })(),
  );
}

/**
 * Apply the colour scheme the control now shows, then tell the main process.
 *
 * The page changes first and at once, in the task of the `change` event, so the
 * whole window is in the new scheme in the next frame whatever the bridge takes.
 * The main process then moves what the page cannot — the frame, the menu bar
 * and the preference the page sees — and keeps the choice for the next start
 * (`src/app/theme.ts`). Its reply carries the choice back and is not shown: by
 * the time it arrives a person may have chosen again, and the control already
 * says what they chose last.
 */
function chooseTheme(shell: Shell): void {
  const choice = Object.values(ThemeChoice).find((each) => each === shell.theme.value);
  if (choice === undefined) {
    return;
  }
  shell.showTheme(choice);
  run(
    shell,
    (async (): Promise<void> => {
      const reply = await window.gitGraphical.chooseTheme({ choice });
      if (!reply.ok) {
        report(shell, reply);
      }
    })(),
  );
}

/** Show the colour scheme the main process applied before this window existed. */
async function showStoredTheme(shell: Shell): Promise<void> {
  const reply = await window.gitGraphical.themeChoice();
  if (!reply.ok) {
    report(shell, reply);
    return;
  }
  shell.showTheme(reply.value.choice);
}

/**
 * Wire the Branches control: each press is turned into what is checked by
 * `src/contracts/branch-menu.ts`, and the result shown and asked for by `choose`.
 */
function connectBranches(shell: Shell, view: GraphTableView, session: Session): void {
  shell.branches.onShowAll((clicks) => {
    choose(shell, view, session, pressShowAll(session.menu, clicks, session.entries));
  });
  shell.branches.onBranch((name) => {
    choose(shell, view, session, toggleBranch(session.menu, name));
  });
  shell.branches.remotes.addEventListener('change', () => {
    const show = shell.branches.remotes.checked;
    choose(shell, view, session, showingRemotes(session.menu, show), show);
  });
}

/** Wire every control to the bridge. Nothing here runs until something happens. */
function connect(shell: Shell, view: GraphTableView, session: Session): void {
  shell.open.addEventListener('click', () => {
    run(
      shell,
      whileBusy(session, shell.open, OPEN_LABELS, async () => {
        const chosen = await window.gitGraphical.chooseFolder();
        if (!chosen.ok) {
          report(shell, chosen);
          return;
        }
        await open(shell, view, session, chosen.value.path);
      }),
    );
  });

  shell.refresh.addEventListener('click', () => {
    run(
      shell,
      whileBusy(session, shell.refresh, REFRESH_LABELS, async () => {
        receive(shell, view, session, await window.gitGraphical.refresh({}));
      }),
    );
  });

  shell.theme.addEventListener('change', () => {
    chooseTheme(shell);
  });

  connectBranches(shell, view, session);

  view.onLoadMore(() => {
    view.setLoadingMore(true);
    run(
      shell,
      (async (): Promise<void> => {
        try {
          const reply = await window.gitGraphical.loadMoreCommits({ count: LOAD_MORE_COMMITS });
          receive(shell, view, session, reply);
        } finally {
          view.setLoadingMore(false);
        }
      })(),
    );
  });
}

/** Ask what the application was started with, and open it if it was given one. */
async function begin(shell: Shell, view: GraphTableView, session: Session): Promise<void> {
  const started = await window.gitGraphical.startupRepository();
  if (!started.ok) {
    report(shell, started);
    return;
  }
  const path = started.value.path;
  if (path !== null) {
    await open(shell, view, session, path);
  }
}

function start(): void {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('The document has no #app element to render into.');
  }
  const shell = mountShell(root);
  const view = mountGraphTable(shell.stage);
  window[VIEW_GLOBAL_NAME] = {
    mount: mountGraphTable,
    showPage: view.showPage,
    onLoadMore: view.onLoadMore,
  };
  const session: Session = {
    path: null,
    busy: new Set(),
    refs: null,
    menu: SHOW_ALL,
    entries: [],
    showRemoteBranches: true,
  };
  connect(shell, view, session);
  run(shell, showStoredTheme(shell));
  run(shell, begin(shell, view, session));
}

assertBridgeIsPresent();
start();
