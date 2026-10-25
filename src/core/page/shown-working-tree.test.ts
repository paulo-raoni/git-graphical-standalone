import { describe, expect, it } from 'vitest';

import { UNKNOWN_INDEX } from '../../contracts/index';
import type { BranchSelection, WorkingTree } from '../../contracts/index';

import { shownWorkingTree } from './shown-working-tree';

/**
 * Whether a page shows the working tree, over working trees built by hand.
 *
 * Every tree here is dirty, so that a tree passed through and a tree withheld
 * differ in every field the rule may change, and a rule that kept one of them
 * would fail on that field by name.
 */

/** A dirty tree on `main`, HEAD's commit at `headCommitIndex`. */
function dirtyAt(headCommitIndex: number): WorkingTree {
  return {
    hasChanges: true,
    changedFileCount: 2,
    untrackedFileCount: 3,
    headCommitIndex,
    headRefName: 'main',
    isDetached: false,
  };
}

const EVERY_BRANCH: BranchSelection = { branches: null, showRemoteBranches: true };

const EVERY_LOCAL_BRANCH: BranchSelection = { branches: null, showRemoteBranches: false };

const ONE_BRANCH: BranchSelection = { branches: ['refs/heads/feature'], showRemoteBranches: true };

describe('shownWorkingTree, on every branch', () => {
  it('shows the working tree when no selection was asked for', () => {
    const tree = dirtyAt(UNKNOWN_INDEX);
    expect(shownWorkingTree(tree, undefined)).toBe(tree);
  });

  it('shows it on every branch even when HEAD’s commit is past the page', () => {
    const tree = dirtyAt(UNKNOWN_INDEX);
    expect(shownWorkingTree(tree, EVERY_BRANCH)).toBe(tree);
  });

  it('shows it on every branch with remote-tracking branches hidden', () => {
    const tree = dirtyAt(UNKNOWN_INDEX);
    expect(shownWorkingTree(tree, EVERY_LOCAL_BRANCH)).toBe(tree);
  });
});

describe('shownWorkingTree, under a selection', () => {
  it('shows the working tree when HEAD’s commit is among the commits read', () => {
    const tree = dirtyAt(0);
    expect(shownWorkingTree(tree, ONE_BRANCH)).toBe(tree);
  });

  it('shows it when HEAD’s commit is the last row read, not only the first', () => {
    const tree = dirtyAt(299);
    expect(shownWorkingTree(tree, ONE_BRANCH)).toBe(tree);
  });

  it('withholds it when HEAD’s commit is not among the commits read', () => {
    expect(shownWorkingTree(dirtyAt(UNKNOWN_INDEX), ONE_BRANCH)).toEqual({
      hasChanges: false,
      changedFileCount: 0,
      untrackedFileCount: 0,
      headCommitIndex: UNKNOWN_INDEX,
      headRefName: 'main',
      isDetached: false,
    });
  });

  it('withholds it under an empty selection, which reads no commit', () => {
    const withheld = shownWorkingTree(dirtyAt(UNKNOWN_INDEX), {
      branches: [],
      showRemoteBranches: false,
    });
    expect(withheld.hasChanges).toBe(false);
  });

  it('keeps what HEAD is called when it withholds the files', () => {
    const detached: WorkingTree = {
      ...dirtyAt(UNKNOWN_INDEX),
      headRefName: null,
      isDetached: true,
    };
    const withheld = shownWorkingTree(detached, ONE_BRANCH);
    expect(withheld.headRefName).toBeNull();
    expect(withheld.isDetached).toBe(true);
  });
});
