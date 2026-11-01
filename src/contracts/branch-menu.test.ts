import { describe, expect, it } from 'vitest';

import {
  boxText,
  branchEntries,
  isChecked,
  matchingEntries,
  pressShowAll,
  RefFlag,
  RefKind,
  sameEntries,
  sameSelection,
  selectionOf,
  SHOW_ALL,
  SHOW_ALL_LABEL,
  showingRemotes,
  toggleBranch,
  UNKNOWN_INDEX,
} from './index';
import type { BranchEntry, BranchMenu, Refs } from './index';

/** A block of references written by hand: one `[kind, name, flags]` each. */
function block(...refs: readonly (readonly [RefKind, string, number?])[]): Refs {
  const offsets = [0];
  for (const [, name] of refs) {
    offsets.push((offsets.at(-1) ?? 0) + name.length);
  }
  return {
    count: refs.length,
    kind: Uint8Array.from(refs, ([kind]) => kind),
    commitIndex: Uint32Array.from(refs, () => UNKNOWN_INDEX),
    nameOffsets: Uint32Array.from(offsets),
    names: refs.map(([, name]) => name).join(''),
    flags: Uint8Array.from(refs, ([, , flags]) => flags ?? 0),
  };
}

/**
 * The shape of the remotes fixture, written out of order on purpose: the
 * checked-out `main` is neither first nor first by name, and the remote names
 * are not in code-unit order either. A tag and the stash ride along, to be left
 * out.
 */
const REMOTES = block(
  [RefKind.LocalHead, 'topic'],
  [RefKind.RemoteBranch, 'origin/only-remote'],
  [RefKind.Tag, 'light'],
  [RefKind.LocalHead, 'main', RefFlag.CheckedOut],
  [RefKind.RemoteBranch, 'origin/feature'],
  [RefKind.Stash, 'stash'],
  [RefKind.LocalHead, 'feature'],
  [RefKind.RemoteSymbolicHead, 'origin/HEAD'],
  [RefKind.LocalHead, 'release'],
  [RefKind.RemoteBranch, 'origin/main'],
);

const local = (label: string): BranchEntry => ({ name: `refs/heads/${label}`, label });
const remote = (label: string): BranchEntry => ({ name: `refs/remotes/${label}`, label });

const LOCALS = [local('main'), local('feature'), local('release'), local('topic')];
const ENTRIES = [
  ...LOCALS,
  remote('origin/HEAD'),
  remote('origin/feature'),
  remote('origin/main'),
  remote('origin/only-remote'),
];

const menu = (showAll: boolean, ...branches: string[]): BranchMenu => ({
  showAll,
  branches,
  pressedFromEvery: false,
});

const EVERY = menu(true, ...ENTRIES.map((entry) => entry.name));
const FEATURE = 'refs/heads/feature';
const MAIN = 'refs/heads/main';
const ONLY_REMOTE = 'refs/remotes/origin/only-remote';

describe('the entries the list offers', () => {
  it('are the checked-out branch, the other locals by name, then the remotes by name', () => {
    expect(branchEntries(REMOTES, true)).toEqual(ENTRIES);
  });

  it('leave the remote branches out while they are hidden', () => {
    expect(branchEntries(REMOTES, false)).toEqual(LOCALS);
  });

  it('put no branch first when none is checked out, as on a detached HEAD', () => {
    const detached = block([RefKind.LocalHead, 'b'], [RefKind.LocalHead, 'a']);
    expect(branchEntries(detached, true)).toEqual([local('a'), local('b')]);
  });

  it('are none for a block of none', () => {
    expect(branchEntries(block(), true)).toEqual([]);
  });

  it('compare as the same list only when they name the same entries in the same order', () => {
    expect(sameEntries(ENTRIES, branchEntries(REMOTES, true))).toBe(true);
    expect(sameEntries([], [])).toBe(true);
    expect(sameEntries(ENTRIES, LOCALS)).toBe(false);
    expect(sameEntries(LOCALS, [...LOCALS].reverse())).toBe(false);
    expect(sameEntries([local('a')], [{ name: 'refs/heads/a', label: 'another label' }])).toBe(
      true,
    );
  });
});

describe('the filter', () => {
  it('keeps the entries whose name contains the text, ignoring case, in order', () => {
    expect(matchingEntries(ENTRIES, 'FeAt')).toEqual([local('feature'), remote('origin/feature')]);
    expect(matchingEntries(ENTRIES, 'head')).toEqual([remote('origin/HEAD')]);
  });

  it('keeps every entry when it is empty, and none when nothing matches', () => {
    expect(matchingEntries(ENTRIES, '')).toEqual(ENTRIES);
    expect(matchingEntries(ENTRIES, 'nothing')).toEqual([]);
  });
});

describe('a click on a branch', () => {
  it('adds it to what is checked and unchecks Show All', () => {
    const one = toggleBranch(SHOW_ALL, FEATURE);
    expect(one).toEqual(menu(false, FEATURE));
    expect(toggleBranch(one, MAIN)).toEqual(menu(false, FEATURE, MAIN));
    expect(isChecked(one, FEATURE)).toBe(true);
    expect(isChecked(one, MAIN)).toBe(false);
  });

  it('removes a checked one, and returns to Show All when it was the last', () => {
    expect(toggleBranch(menu(false, FEATURE, MAIN), FEATURE)).toEqual(menu(false, MAIN));
    expect(toggleBranch(menu(false, FEATURE), FEATURE)).toBe(SHOW_ALL);
  });

  it('unchecks only that one when every entry was checked', () => {
    const rest = ENTRIES.map((entry) => entry.name).filter((name) => name !== FEATURE);
    expect(toggleBranch(EVERY, FEATURE)).toEqual(menu(false, ...rest));
  });
});

describe('a press of Show All', () => {
  it('clears every other entry', () => {
    expect(pressShowAll(menu(false, FEATURE, MAIN), 1, ENTRIES)).toEqual(SHOW_ALL);
    expect(pressShowAll(SHOW_ALL, 1, ENTRIES)).toEqual(SHOW_ALL);
  });

  it('checks every entry on a double-click from Show All alone or from some branches', () => {
    for (const before of [SHOW_ALL, menu(false, FEATURE)]) {
      expect(pressShowAll(pressShowAll(before, 1, ENTRIES), 2, ENTRIES)).toEqual(EVERY);
    }
  });

  it('returns to Show All alone on a double-click from every entry checked', () => {
    const first = pressShowAll(EVERY, 1, ENTRIES);
    expect(first).toEqual({ ...SHOW_ALL, pressedFromEvery: true });
    expect(pressShowAll(first, 2, ENTRIES)).toEqual(SHOW_ALL);
  });

  it('counts every entry checked only while Show All is checked too', () => {
    const allButShowAll = menu(false, ...EVERY.branches);
    expect(pressShowAll(allButShowAll, 1, ENTRIES)).toEqual(SHOW_ALL);
    expect(pressShowAll(pressShowAll(allButShowAll, 1, ENTRIES), 2, ENTRIES)).toEqual(EVERY);
  });

  it('treats a third press of one gesture as a first', () => {
    const toggled = pressShowAll(pressShowAll(SHOW_ALL, 1, ENTRIES), 2, ENTRIES);
    expect(pressShowAll(toggled, 3, ENTRIES)).toEqual({ ...SHOW_ALL, pressedFromEvery: true });
  });

  it('with no entry at all, is Show All alone however often it is pressed', () => {
    // Every one of no entries is checked, so each press starts from "every".
    const alone = { ...SHOW_ALL, pressedFromEvery: true };
    expect(pressShowAll(SHOW_ALL, 1, [])).toEqual(alone);
    expect(pressShowAll(alone, 2, [])).toEqual(alone);
  });
});

describe('hiding remote branches', () => {
  it('drops the remote ones from what is checked and keeps the local ones', () => {
    expect(showingRemotes(menu(false, ONLY_REMOTE, FEATURE), false)).toEqual(menu(false, FEATURE));
  });

  it('returns to Show All when only remote ones were checked', () => {
    expect(showingRemotes(menu(false, ONLY_REMOTE), false)).toBe(SHOW_ALL);
    expect(showingRemotes(SHOW_ALL, false)).toBe(SHOW_ALL);
  });

  it('keeps Show All checked beside the local ones from every entry checked', () => {
    expect(showingRemotes(EVERY, false)).toEqual(menu(true, ...LOCALS.map((entry) => entry.name)));
  });

  it('restores nothing when they are shown again', () => {
    const kept = menu(false, ONLY_REMOTE, FEATURE);
    expect(showingRemotes(kept, true)).toBe(kept);
    expect(showingRemotes(showingRemotes(kept, false), true)).toEqual(menu(false, FEATURE));
  });

  it('drops a local branch whose name begins like a remote one only by its prefix', () => {
    const lookalike = 'refs/heads/refs/remotes/x';
    expect(showingRemotes(menu(false, lookalike), false)).toEqual(menu(false, lookalike));
  });
});

describe('the selection the graph is asked for', () => {
  it('is every branch while Show All is checked, even with every entry checked', () => {
    expect(selectionOf(SHOW_ALL, true)).toEqual({ branches: null, showRemoteBranches: true });
    expect(selectionOf(EVERY, false)).toEqual({ branches: null, showRemoteBranches: false });
  });

  it('is the checked branches otherwise', () => {
    expect(selectionOf(menu(false, FEATURE, MAIN), true)).toEqual({
      branches: [FEATURE, MAIN],
      showRemoteBranches: true,
    });
  });

  it('is the same as another only when both ask for the same page', () => {
    const all = selectionOf(SHOW_ALL, true);
    expect(sameSelection(all, selectionOf(EVERY, true))).toBe(true);
    expect(sameSelection(all, selectionOf(SHOW_ALL, false))).toBe(false);
    expect(sameSelection(all, { branches: [], showRemoteBranches: true })).toBe(false);
    const two = { branches: ['refs/heads/a', 'refs/heads/b'], showRemoteBranches: true };
    expect(sameSelection(two, { ...two, branches: ['refs/heads/a', 'refs/heads/b'] })).toBe(true);
    expect(sameSelection(two, { ...two, branches: ['refs/heads/b', 'refs/heads/a'] })).toBe(false);
    expect(sameSelection(two, { ...two, branches: ['refs/heads/a,refs/heads/b'] })).toBe(false);
  });
});

describe('what the closed box says', () => {
  it('is Show All while Show All is checked', () => {
    expect(SHOW_ALL_LABEL).toBe('Show All');
    expect(boxText(SHOW_ALL, ENTRIES)).toBe('Show All');
    expect(boxText(EVERY, ENTRIES)).toBe('Show All');
  });

  it('names one, two and three branches in list order, not click order', () => {
    expect(boxText(menu(false, ONLY_REMOTE), ENTRIES)).toBe('origin/only-remote');
    expect(boxText(menu(false, ONLY_REMOTE, MAIN), ENTRIES)).toBe('main & origin/only-remote');
    expect(boxText(menu(false, ONLY_REMOTE, FEATURE, MAIN), ENTRIES)).toBe(
      'main, feature & origin/only-remote',
    );
    expect(boxText(menu(false, ONLY_REMOTE, 'refs/heads/topic', FEATURE, MAIN), ENTRIES)).toBe(
      'main, feature, topic & origin/only-remote',
    );
  });

  it('names a checked branch the list no longer offers by its short name, after the rest', () => {
    const gone = menu(false, 'refs/remotes/origin/gone', 'refs/heads/gone', FEATURE);
    expect(boxText(gone, ENTRIES)).toBe('feature, origin/gone & gone');
  });
});
