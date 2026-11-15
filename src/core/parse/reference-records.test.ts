import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH, RefFlag, RefKind } from '../../contracts/index';

import { createReferenceList } from './reference-list';
import type { ReferenceList } from './reference-list';
import {
  createReferenceParser,
  finishReferences,
  pushReferences,
  REFERENCE_FORMAT,
} from './reference-records';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const RECORD = String.fromCharCode(0x1e);
const UNIT = String.fromCharCode(0x1f);

const COMMIT_A = '11'.repeat(HASH_BYTE_LENGTH);
const COMMIT_B = '22'.repeat(HASH_BYTE_LENGTH);
const TAG_OBJECT = '99'.repeat(HASH_BYTE_LENGTH);

/** One `for-each-ref` record, in the order `REFERENCE_FORMAT` asks for. */
function referenceRecord(
  refname: string,
  objectType: string,
  objectName: string,
  dereferenced = '',
  symref = '',
  head = ' ',
): string {
  return `${RECORD}${[refname, objectType, objectName, dereferenced, symref, head].join(UNIT)}\n`;
}

function readReferences(text: string, chunkSize = 4096): ReferenceList {
  const list = createReferenceList();
  const parser = createReferenceParser(list);
  const bytes = bytesOf(text);
  for (let at = 0; at < bytes.length; at += chunkSize) {
    pushReferences(parser, bytes.subarray(at, Math.min(at + chunkSize, bytes.length)));
  }
  finishReferences(parser);
  return list;
}

describe('the formats asked of git', () => {
  it('asks for-each-ref for exactly the fields the parser reads, in that order', () => {
    expect(REFERENCE_FORMAT.split('%1f')).toEqual([
      '%1e%(refname)',
      '%(objecttype)',
      '%(objectname)',
      '%(*objectname)',
      '%(symref)',
      '%(HEAD)',
    ]);
  });
});

describe('pushReferences, on branches', () => {
  it('reads a local branch and marks the one that is checked out', () => {
    const list = readReferences(
      referenceRecord('refs/heads/main', 'commit', COMMIT_A, '', '', '*') +
        referenceRecord('refs/heads/dev', 'commit', COMMIT_B),
    );
    expect(list.names).toEqual(['main', 'dev']);
    expect(list.kinds).toEqual([RefKind.LocalHead, RefKind.LocalHead]);
    expect(list.flags).toEqual([RefFlag.CheckedOut, 0]);
    expect(list.targets[0]).toBe(0x11);
    expect(list.targets[HASH_BYTE_LENGTH]).toBe(0x22);
  });

  it('reads a remote-tracking branch under its remote', () => {
    const list = readReferences(referenceRecord('refs/remotes/origin/dev', 'commit', COMMIT_A));
    expect(list.names).toEqual(['origin/dev']);
    expect(list.kinds).toEqual([RefKind.RemoteBranch]);
  });

  it('tells a remote symbolic head from a branch by its symref, not by its name', () => {
    const list = readReferences(
      referenceRecord(
        'refs/remotes/origin/HEAD',
        'commit',
        COMMIT_A,
        '',
        'refs/remotes/origin/main',
      ) + referenceRecord('refs/remotes/origin/HEAD-of-the-river', 'commit', COMMIT_B),
    );
    expect(list.kinds).toEqual([RefKind.RemoteSymbolicHead, RefKind.RemoteBranch]);
    expect(list.names).toEqual(['origin/HEAD', 'origin/HEAD-of-the-river']);
  });
});

describe('pushReferences, on tags', () => {
  it('reads a lightweight tag as a tag that is not annotated', () => {
    const list = readReferences(referenceRecord('refs/tags/v1.0', 'commit', COMMIT_A));
    expect(list.kinds).toEqual([RefKind.Tag]);
    expect(list.names).toEqual(['v1.0']);
    expect(list.flags).toEqual([0]);
  });

  it('reads an annotated tag as the commit it dereferences to', () => {
    const list = readReferences(referenceRecord('refs/tags/v2.0', 'tag', TAG_OBJECT, COMMIT_B));
    expect(list.kinds).toEqual([RefKind.Tag]);
    expect(list.flags).toEqual([RefFlag.AnnotatedTag]);
    expect(list.targets[0]).toBe(0x22);
  });

  it('skips a reference outside the three kinds it shows', () => {
    const list = readReferences(referenceRecord('refs/notes/commits', 'commit', COMMIT_A));
    expect(list.count).toBe(0);
  });

  it('skips an annotated tag that dereferences to no commit', () => {
    const list = readReferences(referenceRecord('refs/tags/of-a-blob', 'tag', TAG_OBJECT));
    expect(list.count).toBe(0);
  });
});

describe('pushReferences, across chunk boundaries', () => {
  it('reads the same references at every chunk size, down to one byte', () => {
    const text =
      referenceRecord('refs/heads/main', 'commit', COMMIT_A, '', '', '*') +
      referenceRecord('refs/tags/v2.0', 'tag', TAG_OBJECT, COMMIT_B);
    const whole = readReferences(text);
    for (let size = 1; size <= text.length + 1; size += 1) {
      const found = readReferences(text, size);
      expect(found.names).toEqual(whole.names);
      expect(found.kinds).toEqual(whole.kinds);
      expect(found.flags).toEqual(whole.flags);
      expect([...found.targets]).toEqual([...whole.targets]);
    }
  });

  it('refuses a record with the wrong number of fields, and says how many it wanted', () => {
    expect(() => readReferences(`${RECORD}refs/heads/main${UNIT}commit\n`)).toThrow(
      /a reference record has 6 fields, not 2/,
    );
  });
});

describe('finishReferences', () => {
  it('reads a last record that arrived without its line feed', () => {
    const text = referenceRecord('refs/heads/main', 'commit', COMMIT_A).slice(0, -1);
    expect(readReferences(text).names).toEqual(['main']);
  });
});
