import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, UNKNOWN_INDEX } from '../../contracts/index';

import {
  buildWorkingTree,
  createStatusParser,
  finishStatus,
  pushStatus,
} from './working-tree-status';
import type { StatusFacts } from './working-tree-status';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const NUL = String.fromCharCode(0);

const HEAD_COMMIT = 'ab'.repeat(HASH_BYTE_LENGTH);

/** The records of one `status --porcelain=v2 -z` reading, already terminated. */
const streamOf = (records: readonly string[]): string =>
  records.map((record) => `${record}${NUL}`).join('');

function readStatus(text: string, chunkSize = 4096): StatusFacts {
  const parser = createStatusParser();
  const bytes = bytesOf(text);
  for (let at = 0; at < bytes.length; at += chunkSize) {
    pushStatus(parser, bytes.subarray(at, Math.min(at + chunkSize, bytes.length)));
  }
  finishStatus(parser);
  return parser.facts;
}

const CHANGED = '1 .M N... 100644 100644 100644 aaa bbb file.txt';
const UNMERGED = 'u UU N... 100644 100644 100644 100644 aaa bbb ccc both.txt';
const RENAMED = '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt';

describe('pushStatus, on the branch headers', () => {
  it('reads the branch HEAD is on and the commit it stands at', () => {
    const facts = readStatus(streamOf([`# branch.oid ${HEAD_COMMIT}`, '# branch.head main']));
    expect(facts.hasHead).toBe(true);
    expect(facts.headHash[0]).toBe(0xab);
    expect(facts.headRefName).toBe('main');
    expect(facts.isDetached).toBe(false);
  });

  it('reads a detached HEAD as detached, with no name', () => {
    const facts = readStatus(streamOf([`# branch.oid ${HEAD_COMMIT}`, '# branch.head (detached)']));
    expect(facts.isDetached).toBe(true);
    expect(facts.headRefName).toBeNull();
  });

  it('reads a branch with no commit yet as having no HEAD commit', () => {
    const facts = readStatus(streamOf(['# branch.oid (initial)', '# branch.head main']));
    expect(facts.hasHead).toBe(false);
    expect(facts.headRefName).toBe('main');
  });

  it('ignores a header it has no question for', () => {
    const facts = readStatus(
      streamOf(['# branch.upstream origin/main', '# branch.ab +1 -2', '# branch.head main']),
    );
    expect(facts.headRefName).toBe('main');
    expect(facts.changedFileCount).toBe(0);
  });

  it('takes no branch name from a header that is not the branch header', () => {
    const facts = readStatus(streamOf(['# branch.upstream origin/main', '# branch.ab +1 -2']));
    expect(facts.headRefName).toBeNull();
    expect(facts.isDetached).toBe(true);
    expect(facts.hasHead).toBe(false);
  });

  it('takes no commit from a header that is not the object name header', () => {
    const facts = readStatus(streamOf(['# branch.upstream origin/main', '# branch.head main']));
    expect(facts.hasHead).toBe(false);
    expect([...facts.headHash]).toEqual(Array.from({ length: HASH_BYTE_LENGTH }, () => 0));
  });
});

describe('pushStatus, on the entries', () => {
  it('counts changed, unmerged and untracked files apart', () => {
    const facts = readStatus(
      streamOf([CHANGED, UNMERGED, '? one.txt', '? two.txt', '? three.txt']),
    );
    expect(facts.changedFileCount).toBe(2);
    expect(facts.untrackedFileCount).toBe(3);
  });

  it('counts a rename as a changed file in its own right', () => {
    const facts = readStatus(streamOf([RENAMED, 'was-called-this.txt']));
    expect(facts.changedFileCount).toBe(1);
    expect(facts.untrackedFileCount).toBe(0);
  });

  it('does not read the original path of a rename as an entry of its own', () => {
    const facts = readStatus(streamOf([RENAMED, '1-was-called-this.txt', '? new.txt']));
    expect(facts.changedFileCount).toBe(1);
    expect(facts.untrackedFileCount).toBe(1);
  });

  it('reads the entry after a rename as an entry again', () => {
    const facts = readStatus(streamOf([RENAMED, 'old.txt', CHANGED, '? new.txt']));
    expect(facts.changedFileCount).toBe(2);
    expect(facts.untrackedFileCount).toBe(1);
  });

  it('ignores a record it does not classify', () => {
    const facts = readStatus(streamOf(['! ignored.txt']));
    expect(facts.changedFileCount).toBe(0);
    expect(facts.untrackedFileCount).toBe(0);
  });

  it('ignores an empty record', () => {
    const facts = readStatus(streamOf(['', '? one.txt']));
    expect(facts.untrackedFileCount).toBe(1);
  });

  it('reads a path holding a newline, a tab and a quotation mark literally', () => {
    const facts = readStatus(streamOf(['? odd\n\t"name".txt']));
    expect(facts.untrackedFileCount).toBe(1);
  });
});

describe('pushStatus, across chunk boundaries', () => {
  it('reads the same facts at every chunk size, down to one byte', () => {
    const text = streamOf([
      `# branch.oid ${HEAD_COMMIT}`,
      '# branch.head main',
      CHANGED,
      RENAMED,
      'old.txt',
      '? new.txt',
    ]);
    const whole = readStatus(text);
    for (let size = 1; size <= text.length + 1; size += 1) {
      const found = readStatus(text, size);
      expect(found.changedFileCount).toBe(whole.changedFileCount);
      expect(found.untrackedFileCount).toBe(whole.untrackedFileCount);
      expect(found.headRefName).toBe(whole.headRefName);
      expect([...found.headHash]).toEqual([...whole.headHash]);
    }
  });
});

describe('finishStatus', () => {
  it('reads a last record that arrived without its terminator', () => {
    expect(readStatus('? one.txt').untrackedFileCount).toBe(1);
  });
});

describe('buildWorkingTree', () => {
  it('says there are changes when there is anything at all', () => {
    const facts = readStatus(streamOf(['# branch.head main', '? one.txt']));
    const tree = buildWorkingTree(facts, UNKNOWN_INDEX);
    expect(tree.hasChanges).toBe(true);
    expect(tree.untrackedFileCount).toBe(1);
    expect(tree.changedFileCount).toBe(0);
    expect(tree.headCommitIndex).toBe(UNKNOWN_INDEX);
    expect(tree.headRefName).toBe('main');
    expect(tree.isDetached).toBe(false);
  });

  it('says there are none when the tree is clean', () => {
    const facts = readStatus(streamOf([`# branch.oid ${HEAD_COMMIT}`, '# branch.head main']));
    const tree = buildWorkingTree(facts, 4);
    expect(tree.hasChanges).toBe(false);
    expect(tree.headCommitIndex).toBe(4);
  });

  it('keeps the pair a detached HEAD has to be: no name, and detached', () => {
    const tree = buildWorkingTree(readStatus(''), UNKNOWN_INDEX);
    expect(tree.headRefName).toBeNull();
    expect(tree.isDetached).toBe(true);
  });
});
