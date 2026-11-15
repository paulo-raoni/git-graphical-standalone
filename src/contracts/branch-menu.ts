import { refCount, refFlagsOf, refKindOf, refNameOf } from './ref-list';
import { RefFlag, RefKind } from './refs';
import type { BranchSelection } from './ipc';
import type { Refs } from './refs';

/**
 * The rules of the bar's Branches dropdown: which entries it lists and in what
 * order, what a click does to what is checked, what hiding remote branches does
 * to it, what the closed box says, and which {@link BranchSelection} the graph is
 * asked for.
 *
 * **Why this ring.** Each of these is a decision that can be wrong, and
 * `docs/ADR-0002-architecture-and-performance.md` decision 1 keeps every such
 * decision out of `src/ui/`. The renderer may import `src/contracts/` and nothing
 * else (`ui-only-contracts`), so `src/core/` is out of its reach, and this ring is
 * the one inside both the renderer's reach and the mutation gate's scope. It
 * keeps this ring's other rule: it imports only its siblings and keeps nothing
 * between calls. Every function takes what it reads and answers a new value.
 *
 * The behaviour these rules reproduce was observed in the reference extension by
 * an observer session on 2026-10-25 and is recorded in
 * `docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S10-branches-dropdown.md`,
 * which also says which of them are this project's own decisions.
 */

/** What the first entry of the list, and the box with nothing selected, say. */
export const SHOW_ALL_LABEL = 'Show All';

/** What a local branch's full reference name begins with. */
export const LOCAL_PREFIX = 'refs/heads/';
/** What a remote-tracking branch's full reference name begins with. */
export const REMOTE_PREFIX = 'refs/remotes/';

/** One branch the list offers. */
export interface BranchEntry {
  /** The full reference name a {@link BranchSelection} names it by. */
  readonly name: string;
  /** What the list and the box show: the name git reports, remote included. */
  readonly label: string;
}

/**
 * What the list has checked.
 *
 * Invariants: `branches` holds no name twice; when `showAll` is false it is not
 * empty. `showAll` with `branches` empty is Show All alone, the state a
 * repository with nothing kept opens on; `showAll` with `branches` holding every
 * entry is "every entry checked", which a double-click on Show All toggles to.
 */
export interface BranchMenu {
  /** Whether Show All is checked, which is whether the graph shows every branch. */
  readonly showAll: boolean;
  /** Full names of the checked branches, in the order they were checked. */
  readonly branches: readonly string[];
  /**
   * Whether every entry was checked when the press of Show All that made this
   * menu began. Read by the second press of a double-click, which by then sees
   * only what the first press left; false after anything but a press of Show All.
   */
  readonly pressedFromEvery: boolean;
}

/**
 * Show All alone: what a repository with nothing kept for it opens on, and what
 * Show All returns to.
 */
export const SHOW_ALL: BranchMenu = /* @__PURE__ */ Object.freeze({
  showAll: true,
  branches: /* @__PURE__ */ Object.freeze([]),
  pressedFromEvery: false,
});

/** An entry for each label, under `prefix`. */
function entriesUnder(prefix: string, labels: readonly string[]): BranchEntry[] {
  return labels.map((label) => ({ name: prefix + label, label }));
}

/** A list of names as one comparable value. */
function namesOf(entries: readonly BranchEntry[]): string {
  return JSON.stringify(entries.map((entry) => entry.name));
}

/**
 * The entries the list offers, in its order: the checked-out branch, the other
 * local branches by name, then, while they are shown, the remote-tracking
 * branches by name, each remote's HEAD among them. Tags and the stash are not
 * listed. Names are in code-unit order, the default order of `sort`. Git lists
 * references in code-point order, the byte order of their UTF-8 spelling, and the
 * two orders differ only where two names first differ by a character above U+FFFF
 * against one from U+E000 to U+FFFF: code-unit order puts the first ahead, git the
 * second. Measured by E04-M01-S03 on 2026-11-03 with git 2.51.0 on Windows,
 * through `for-each-ref` and `branch --list`, loose and packed, over thirteen
 * names from U+005A to U+20000. That the two orders agree on every other pair
 * follows from how UTF-16 spells a character above U+FFFF, and was not measured.
 */
export function branchEntries(refs: Refs, showRemoteBranches: boolean): BranchEntry[] {
  const current: string[] = [];
  const locals: string[] = [];
  const remotes: string[] = [];
  for (let ref = 0; ref < refCount(refs); ref += 1) {
    const kind = refKindOf(refs, ref);
    const label = refNameOf(refs, ref);
    if (kind === RefKind.LocalHead) {
      const checkedOut = (refFlagsOf(refs, ref) & RefFlag.CheckedOut) !== 0;
      (checkedOut ? current : locals).push(label);
    } else if (
      showRemoteBranches &&
      (kind === RefKind.RemoteBranch || kind === RefKind.RemoteSymbolicHead)
    ) {
      remotes.push(label);
    }
  }
  return [
    ...entriesUnder(LOCAL_PREFIX, [...current, ...locals.sort()]),
    ...entriesUnder(REMOTE_PREFIX, remotes.sort()),
  ];
}

/** Whether two lists offer the same entries in the same order. */
export function sameEntries(a: readonly BranchEntry[], b: readonly BranchEntry[]): boolean {
  return namesOf(a) === namesOf(b);
}

/**
 * The entries whose label contains `text`, ignoring case, in the list's order.
 * An empty filter keeps every entry. Show All is not an entry and always stays.
 */
export function matchingEntries(entries: readonly BranchEntry[], text: string): BranchEntry[] {
  const wanted = text.toLowerCase();
  return entries.filter((entry) => entry.label.toLowerCase().includes(wanted));
}

/** Whether the entry named `name` is checked. */
export function isChecked(menu: BranchMenu, name: string): boolean {
  return menu.branches.includes(name);
}

/**
 * A click on a branch: checks it, or unchecks it when it was checked. Either way
 * Show All is unchecked, unless nothing is left checked, which is Show All alone.
 */
export function toggleBranch(menu: BranchMenu, name: string): BranchMenu {
  const branches = isChecked(menu, name)
    ? menu.branches.filter((each) => each !== name)
    : [...menu.branches, name];
  return branches.length === 0 ? SHOW_ALL : { showAll: false, branches, pressedFromEvery: false };
}

/**
 * A press of Show All, `clicks` being its count within one gesture (the event's
 * `detail`). A press clears every other entry. The second press of a
 * double-click instead toggles between Show All alone and every entry checked:
 * to Show All alone if every entry was checked when the gesture began, to every
 * entry checked otherwise.
 */
export function pressShowAll(
  menu: BranchMenu,
  clicks: number,
  entries: readonly BranchEntry[],
): BranchMenu {
  if (clicks === 2 && !menu.pressedFromEvery) {
    return { showAll: true, branches: entries.map((entry) => entry.name), pressedFromEvery: false };
  }
  const every = menu.showAll && entries.every((entry) => isChecked(menu, entry.name));
  return { ...SHOW_ALL, pressedFromEvery: every };
}

/**
 * Show Remote Branches checked or unchecked. Unchecking it drops every
 * remote-tracking branch from what is checked and keeps the local ones, which
 * is Show All alone when only remote ones were checked. Checking it again
 * restores nothing.
 */
export function showingRemotes(menu: BranchMenu, show: boolean): BranchMenu {
  if (show) {
    return menu;
  }
  const branches = menu.branches.filter((name) => !name.startsWith(REMOTE_PREFIX));
  return branches.length === 0
    ? SHOW_ALL
    : { showAll: menu.showAll, branches, pressedFromEvery: false };
}

/** What the graph is asked for under `menu`: every branch while Show All is checked. */
export function selectionOf(menu: BranchMenu, showRemoteBranches: boolean): BranchSelection {
  return { branches: menu.showAll ? null : menu.branches, showRemoteBranches };
}

/**
 * The menu that shows `selection`: Show All alone for every branch, and otherwise
 * those branches checked, in its order. It is how an opened repository's control
 * shows what survives of the selection kept for it (`survivingSelection` of
 * `./kept-selection.ts`), which never names an empty list.
 */
export function menuOf(selection: BranchSelection): BranchMenu {
  return selection.branches === null
    ? SHOW_ALL
    : { showAll: false, branches: selection.branches, pressedFromEvery: false };
}

/** Whether two selections ask for the same page, so that a second request would be wasted. */
export function sameSelection(a: BranchSelection, b: BranchSelection): boolean {
  return (
    a.showRemoteBranches === b.showRemoteBranches &&
    JSON.stringify(a.branches) === JSON.stringify(b.branches)
  );
}

/**
 * What the closed box says: Show All while it is checked, and otherwise the
 * checked branches in the list's order — `a`, `a & b`, `a, b & c`. A checked name
 * the list no longer offers, such as a branch deleted since, follows them by its
 * short name.
 */
export function boxText(menu: BranchMenu, entries: readonly BranchEntry[]): string {
  if (menu.showAll) {
    return SHOW_ALL_LABEL;
  }
  const labels = entries.filter((entry) => isChecked(menu, entry.name)).map((entry) => entry.label);
  for (const name of menu.branches) {
    if (!entries.some((entry) => entry.name === name)) {
      const prefix = name.startsWith(LOCAL_PREFIX) ? LOCAL_PREFIX : REMOTE_PREFIX;
      labels.push(name.slice(prefix.length));
    }
  }
  // Never empty, so `reduce` needs no first value: `showAll` is false only while
  // a branch is checked, and every checked name gave a label above.
  return labels.reduce(
    (text, label, at) => `${text}${at === labels.length - 1 ? ' & ' : ', '}${label}`,
  );
}
