import { describe, expect, it } from 'vitest';

import { FailureKind } from '../../contracts/index';
import type { CommitDetails, Result } from '../../contracts/index';

import {
  COMMIT_DETAILS_FORMAT,
  createCommitDetailsParser,
  finishCommitDetails,
  pushCommitDetails,
} from './commit-details';

/**
 * The output is written as `git log -1 -z --format=<COMMIT_DETAILS_FORMAT>
 * --raw --numstat` writes it (measured with git 2.51.0): the header, a NUL, then
 * a line feed and the changed files, each of their records ended by a NUL; a
 * commit that changed nothing ends at the header's NUL.
 */

const NUL = '\u0000';
const RS = '\u001e';
const US = '\u001f';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const FIRST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECOND = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** The UTF-8 bytes of `text`. */
function utf8Of(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

interface Header {
  readonly hash?: string;
  readonly parents?: string;
  readonly message?: string;
}

const MESSAGE = 'the subject\n\n    four spaces\n\ta tab\n\nafter a blank line\n';

/** A header record as git writes it, unterminated. */
const headerOf = (header: Header = {}): string =>
  [
    `${RS}${header.hash ?? HASH}`,
    header.parents ?? FIRST,
    'Añ Author',
    'author@example.invalid',
    '1700000000 +0130',
    'Ç Committer',
    'committer@example.invalid',
    '-86400 -0745',
    header.message ?? MESSAGE,
  ].join(US);

/** The details read from `text`, cut into chunks of `size` bytes, for `asked`. */
function detailsOf(text: string, asked = HASH, size = 4096): Result<CommitDetails> {
  const bytes = utf8Of(text);
  const parser = createCommitDetailsParser();
  for (let at = 0; at < bytes.length; at += size) {
    pushCommitDetails(parser, Uint8Array.from(bytes.slice(at, at + size)));
  }
  return finishCommitDetails(parser, asked);
}

/** The value of a success, or a thrown failure. */
function valueOf(result: Result<CommitDetails>): CommitDetails {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
}

const FILES = [
  `\n:100644 100644 1234567 89abcde R090`,
  'old.txt',
  'new.txt',
  ':000000 100644 0000000 89abcde A',
  'bin.dat',
  '2\t1\t',
  'old.txt',
  'new.txt',
  '-\t-\tbin.dat',
];

const DETAILS: CommitDetails = {
  hash: HASH,
  parents: [FIRST],
  author: {
    name: 'Añ Author',
    email: 'author@example.invalid',
    time: 1700000000,
    offsetMinutes: 90,
  },
  committer: {
    name: 'Ç Committer',
    email: 'committer@example.invalid',
    time: -86400,
    offsetMinutes: -465,
  },
  message: MESSAGE,
  files: [
    { path: 'new.txt', oldPath: 'old.txt', status: 'renamed', additions: 2, deletions: 1 },
    { path: 'bin.dat', oldPath: null, status: 'added', additions: null, deletions: null },
  ],
};

const stream = (header: string, files: readonly string[] = FILES): string =>
  [header, ...files].map((record) => `${record}${NUL}`).join('');

describe('COMMIT_DETAILS_FORMAT', () => {
  it('asks for the record separator, eight unit-separated fields and the raw message last', () => {
    expect(COMMIT_DETAILS_FORMAT).toBe(
      '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%B',
    );
  });
});

describe('the details of a commit', () => {
  it('reads the header, both people and their dates, the message and the files', () => {
    expect(valueOf(detailsOf(stream(headerOf())))).toEqual(DETAILS);
  });

  it('reads the same details whatever the chunks the output arrives in', () => {
    for (const size of [1, 2, 3, 5, 64]) {
      expect(valueOf(detailsOf(stream(headerOf()), HASH, size)), String(size)).toEqual(DETAILS);
    }
  });

  it('reads a root commit as having no parent, and a merge as having each of its parents', () => {
    expect(valueOf(detailsOf(stream(headerOf({ parents: '' })))).parents).toEqual([]);
    const merge = headerOf({ parents: `${FIRST} ${SECOND}` });
    expect(valueOf(detailsOf(stream(merge))).parents).toEqual([FIRST, SECOND]);
  });

  it('reads a commit that changed nothing as having no file', () => {
    expect(valueOf(detailsOf(stream(headerOf(), []))).files).toEqual([]);
  });

  it('keeps every byte of the message, a unit separator and a record separator included', () => {
    const message = ` leading space\n\n\t\ttabs${US}unit${RS}record\r\n\n\n`;
    expect(valueOf(detailsOf(stream(headerOf({ message })))).message).toBe(message);
    expect(valueOf(detailsOf(stream(headerOf({ message: '' })))).message).toBe('');
  });

  it('reads a last record that came without its NUL', () => {
    const text = stream(headerOf()).slice(0, -1);
    expect(valueOf(detailsOf(text))).toEqual(DETAILS);
    expect(valueOf(detailsOf(headerOf())).files).toEqual([]);
  });
});

describe('the details of something that is not the commit asked for', () => {
  const refused = (asked: string): Result<CommitDetails> => ({
    ok: false,
    kind: FailureKind.GitFailed,
    message: `${asked} is not a commit of this repository.`,
  });

  it('answers no output, which is what git says for a tree or a blob, as a failure', () => {
    expect(detailsOf('')).toEqual(refused(HASH));
  });

  it('answers a commit by another name, which is what git says for a tag, as a failure', () => {
    expect(detailsOf(stream(headerOf()), FIRST)).toEqual(refused(FIRST));
    expect(detailsOf(stream(headerOf({ hash: FIRST })))).toEqual(refused(HASH));
  });
});

describe('the details of a commit, against output it cannot read', () => {
  it('refuses a header that does not start with the record separator', () => {
    expect(() => detailsOf(stream(headerOf().slice(1)))).toThrow(
      'a record of git output did not start with the record separator',
    );
  });

  it('refuses a header with fewer fields than were asked for', () => {
    const short = [`${RS}${HASH}`, FIRST, 'name'].join(US);
    expect(() => detailsOf(stream(short))).toThrow("a commit's details have 9 fields, not 3");
  });

  it('refuses output that ends inside a changed file', () => {
    expect(() => detailsOf(stream(headerOf(), [':100644 100644 1 2 M']))).toThrow(
      'git output ended before the paths of a changed file',
    );
  });
});
