import { describe, expect, it } from 'vitest';

import {
  keptSelection,
  menuOf,
  openingSelection,
  RefFlag,
  RefKind,
  SHOW_ALL,
  survivingSelection,
  UNKNOWN_INDEX,
} from './index';
import type { BranchSelection, Refs } from './index';

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

/** The shape of the remotes fixture, with a tag and the stash that are not branches. */
const REMOTES = block(
  [RefKind.LocalHead, 'main', RefFlag.CheckedOut],
  [RefKind.LocalHead, 'feature'],
  [RefKind.LocalHead, 'topic'],
  [RefKind.RemoteSymbolicHead, 'origin/HEAD'],
  [RefKind.RemoteBranch, 'origin/feature'],
  [RefKind.RemoteBranch, 'origin/only-remote'],
  [RefKind.Tag, 'light'],
  [RefKind.Stash, 'stash'],
);

const MAIN = 'refs/heads/main';
const FEATURE = 'refs/heads/feature';
const TOPIC = 'refs/heads/topic';
const ONLY_REMOTE = 'refs/remotes/origin/only-remote';
const ORIGIN_HEAD = 'refs/remotes/origin/HEAD';

const shown = (...branches: string[]): BranchSelection => ({ branches, showRemoteBranches: true });
const hidden = (...branches: string[]): BranchSelection => ({
  branches,
  showRemoteBranches: false,
});
const EVERY: BranchSelection = { branches: null, showRemoteBranches: true };
const EVERY_LOCAL: BranchSelection = { branches: null, showRemoteBranches: false };

describe('a kept record', () => {
  it('is a selection when it holds every branch or distinct full names, either way of remotes', () => {
    expect(keptSelection(EVERY)).toEqual(EVERY);
    expect(keptSelection(EVERY_LOCAL)).toEqual(EVERY_LOCAL);
    expect(keptSelection(shown(FEATURE, ONLY_REMOTE))).toEqual(shown(FEATURE, ONLY_REMOTE));
    expect(keptSelection(hidden(TOPIC))).toEqual(hidden(TOPIC));
    expect(keptSelection(shown())).toEqual(shown());
  });

  it('answers a new object holding the two fields alone', () => {
    const stored = { ...shown(FEATURE), written: 'by hand' };
    const kept = keptSelection(stored);
    expect(kept).toEqual(shown(FEATURE));
    expect(kept).not.toBe(stored);
    expect(Object.keys(kept ?? {})).toEqual(['branches', 'showRemoteBranches']);
    expect(Object.keys(keptSelection({ ...EVERY, written: 'by hand' }) ?? {})).toEqual([
      'branches',
      'showRemoteBranches',
    ]);
  });
});

describe('a kept record that is not one this application wrote', () => {
  it('is nothing when it is not an object, or nothing at all', () => {
    for (const value of [null, undefined, 0, 1, true, false, '', 'text', []]) {
      expect(keptSelection(value)).toBeNull();
    }
  });

  it('is nothing when whether remote branches are shown is missing or not a boolean', () => {
    expect(keptSelection({ branches: null })).toBeNull();
    expect(keptSelection({ branches: [FEATURE] })).toBeNull();
    for (const showRemoteBranches of [null, 0, 1, 'true', 'false', [], {}]) {
      expect(keptSelection({ branches: null, showRemoteBranches })).toBeNull();
      expect(keptSelection({ branches: [FEATURE], showRemoteBranches })).toBeNull();
    }
  });

  it('is nothing when the branches are missing, or neither null nor a list', () => {
    for (const branches of [undefined, FEATURE, 0, false, {}, { 0: FEATURE, length: 1 }]) {
      expect(keptSelection({ branches, showRemoteBranches: true })).toBeNull();
    }
    expect(keptSelection({ showRemoteBranches: true })).toBeNull();
  });

  it('is nothing when a name is not a full reference name of a branch', () => {
    for (const name of ['feature', 'heads/feature', 'refs/tags/light', 'HEAD', 'origin/main']) {
      expect(keptSelection(shown(FEATURE, name))).toBeNull();
    }
    expect(keptSelection(shown(' refs/heads/feature'))).toBeNull();
    for (const name of [null, 1, true, [FEATURE], { name: FEATURE }]) {
      expect(keptSelection({ branches: [FEATURE, name], showRemoteBranches: true })).toBeNull();
    }
  });

  it('is nothing when it names a branch twice', () => {
    expect(keptSelection(shown(FEATURE, TOPIC, FEATURE))).toBeNull();
    expect(keptSelection(shown(FEATURE, TOPIC))).toEqual(shown(FEATURE, TOPIC));
  });
});

describe('the selection an open reads under', () => {
  it('is the kept one', () => {
    const kept = hidden(FEATURE);
    expect(openingSelection(kept, undefined)).toBe(kept);
  });

  it('is every branch with remote branches shown when nothing is kept', () => {
    expect(openingSelection(null, undefined)).toEqual(EVERY);
  });

  it('is every branch as the open says when it says whether remote branches are shown', () => {
    expect(openingSelection(shown(FEATURE), false)).toEqual(EVERY_LOCAL);
    expect(openingSelection(hidden(FEATURE), true)).toEqual(EVERY);
    expect(openingSelection(null, false)).toEqual(EVERY_LOCAL);
  });
});

describe('the kept branches a repository still has', () => {
  it('are every one when the list still offers them all, in the kept order', () => {
    const kept = shown(TOPIC, ONLY_REMOTE, MAIN, ORIGIN_HEAD);
    expect(survivingSelection(kept, REMOTES)).toEqual(kept);
  });

  it('leave out a branch deleted or renamed since it was kept', () => {
    expect(survivingSelection(shown(FEATURE, 'refs/heads/gone', TOPIC), REMOTES)).toEqual(
      shown(FEATURE, TOPIC),
    );
  });

  it('leave out a remote branch whose remote is gone', () => {
    const noRemote = block([RefKind.LocalHead, 'main', RefFlag.CheckedOut]);
    expect(survivingSelection(shown(MAIN, ONLY_REMOTE), noRemote)).toEqual(shown(MAIN));
  });

  it('leave out remote branches while they are hidden, though the block still holds them', () => {
    expect(survivingSelection(hidden(FEATURE, ONLY_REMOTE), REMOTES)).toEqual(hidden(FEATURE));
  });

  it('leave out a tag, the stash, or a local name standing for a remote one', () => {
    const lookalikes = ['refs/heads/light', 'refs/heads/stash', 'refs/heads/origin/feature'];
    expect(survivingSelection(shown(MAIN, ...lookalikes), REMOTES)).toEqual(shown(MAIN));
  });

  it('are every branch when none is left, keeping whether remote branches are shown', () => {
    expect(survivingSelection(shown('refs/heads/gone'), REMOTES)).toEqual(EVERY);
    expect(survivingSelection(hidden(ONLY_REMOTE), REMOTES)).toEqual(EVERY_LOCAL);
    expect(survivingSelection(shown(), REMOTES)).toEqual(EVERY);
    expect(survivingSelection(shown(FEATURE), block())).toEqual(EVERY);
  });

  it('are every branch, the same selection, when every branch was kept', () => {
    expect(survivingSelection(EVERY, REMOTES)).toBe(EVERY);
    expect(survivingSelection(EVERY_LOCAL, block())).toBe(EVERY_LOCAL);
  });
});

describe('the menu an opened selection shows', () => {
  it('is Show All alone for every branch', () => {
    expect(menuOf(EVERY)).toBe(SHOW_ALL);
    expect(menuOf(EVERY_LOCAL)).toBe(SHOW_ALL);
  });

  it('is the selected branches checked, in their order, and Show All not', () => {
    expect(menuOf(shown(TOPIC, FEATURE))).toEqual({
      showAll: false,
      branches: [TOPIC, FEATURE],
      pressedFromEvery: false,
    });
  });
});
