import { describe, expect, it } from 'vitest';

import { HASH_BYTE_LENGTH } from '../../contracts/index';

import {
  COMMIT_LOG_FORMAT,
  createCommitLogParser,
  finishCommitLog,
  pushCommitLog,
} from './commit-log';

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const RECORD = String.fromCharCode(0x1e);
const UNIT = String.fromCharCode(0x1f);
const NUL = String.fromCharCode(0);

/** The UTF-8 bytes of U+1F389, written as the bytes git would put on the pipe. */
const CELEBRATION = String.fromCharCode(0xf0, 0x9f, 0x8e, 0x89);

const NAME_A = '11'.repeat(HASH_BYTE_LENGTH);
const NAME_B = '22'.repeat(HASH_BYTE_LENGTH);
const NAME_C = '33'.repeat(HASH_BYTE_LENGTH);

interface CommitFields {
  readonly hash: string;
  readonly parents: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly committerDate: string;
  readonly subject: string;
}

const DEFAULTS: CommitFields = {
  hash: NAME_A,
  parents: '',
  authorName: 'Ada',
  authorEmail: 'ada@example.invalid',
  authorDate: '1700000000 +0000',
  committerName: 'Grace',
  committerEmail: 'grace@example.invalid',
  committerDate: '1700000060 -0300',
  subject: 'the first commit',
};

/** One record in exactly the shape {@link COMMIT_LOG_FORMAT} produces. */
function commitRecord(changes: Partial<CommitFields> = {}): string {
  const fields = { ...DEFAULTS, ...changes };
  return (
    RECORD +
    [
      fields.hash,
      fields.parents,
      fields.authorName,
      fields.authorEmail,
      fields.authorDate,
      fields.committerName,
      fields.committerEmail,
      fields.committerDate,
      fields.subject,
    ].join(UNIT) +
    NUL
  );
}

/** What one commit looked like, copied out of the buffers the parser reuses. */
interface Seen {
  readonly hash: number[];
  readonly parents: number[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorTime: number;
  readonly authorTzMinutes: number;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly commitTime: number;
  readonly commitTzMinutes: number;
  readonly subject: string;
}

function readCommits(text: string, chunkSize: number): Seen[] {
  const seen: Seen[] = [];
  const parser = createCommitLogParser((commit) => {
    seen.push({
      hash: [...commit.hash],
      parents: [...commit.parentHashes],
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      authorTime: commit.authorTime,
      authorTzMinutes: commit.authorTzMinutes,
      committerName: commit.committerName,
      committerEmail: commit.committerEmail,
      commitTime: commit.commitTime,
      commitTzMinutes: commit.commitTzMinutes,
      subject: commit.subject,
    });
  });
  const bytes = bytesOf(text);
  for (let at = 0; at < bytes.length; at += chunkSize) {
    pushCommitLog(parser, bytes.subarray(at, Math.min(at + chunkSize, bytes.length)));
  }
  finishCommitLog(parser);
  return seen;
}

describe('COMMIT_LOG_FORMAT', () => {
  it('puts the subject last, so no free text can move another field', () => {
    expect(COMMIT_LOG_FORMAT.endsWith('%s')).toBe(true);
    expect(COMMIT_LOG_FORMAT.indexOf('%s')).toBe(COMMIT_LOG_FORMAT.lastIndexOf('%s'));
  });
});

describe('pushCommitLog, on the fields of one commit', () => {
  it('reads every field of one commit', () => {
    const [commit] = readCommits(commitRecord(), 4096);
    expect(commit).toEqual({
      hash: Array.from({ length: HASH_BYTE_LENGTH }, () => 0x11),
      parents: [],
      authorName: 'Ada',
      authorEmail: 'ada@example.invalid',
      authorTime: 1_700_000_000,
      authorTzMinutes: 0,
      committerName: 'Grace',
      committerEmail: 'grace@example.invalid',
      commitTime: 1_700_000_060,
      commitTzMinutes: -180,
      subject: 'the first commit',
    });
  });

  it('reads a commit with one parent', () => {
    const [commit] = readCommits(commitRecord({ parents: NAME_B }), 4096);
    expect(commit?.parents.length).toBe(HASH_BYTE_LENGTH);
    expect(commit?.parents[0]).toBe(0x22);
  });

  it('reads a merge with two parents', () => {
    const [commit] = readCommits(commitRecord({ parents: `${NAME_B} ${NAME_C}` }), 4096);
    expect(commit?.parents.length).toBe(HASH_BYTE_LENGTH * 2);
    expect(commit?.parents[HASH_BYTE_LENGTH]).toBe(0x33);
  });

  it('grows its parent buffer for a merge wider than it started with', () => {
    const parents = Array.from({ length: 9 }, (_, at) =>
      String(at + 1)
        .repeat(2)
        .repeat(HASH_BYTE_LENGTH),
    ).join(' ');
    const [commit] = readCommits(commitRecord({ parents }), 4096);
    expect(commit?.parents.length).toBe(HASH_BYTE_LENGTH * 9);
  });
});

describe('createCommitLogParser, and the buffers it reuses', () => {
  const NAME_D = '44'.repeat(HASH_BYTE_LENGTH);
  const NAME_E = '55'.repeat(HASH_BYTE_LENGTH);
  const nothing = (): void => undefined;

  it('starts with room for four parents, which is a merge and then some', () => {
    expect(createCommitLogParser(nothing).parents.length).toBe(4 * HASH_BYTE_LENGTH);
  });

  it('keeps its parent buffer for a merge that fits in it', () => {
    const parser = createCommitLogParser(nothing);
    const before = parser.parents;
    pushCommitLog(parser, bytesOf(commitRecord({ parents: `${NAME_B} ${NAME_C}` })));
    expect(parser.parents).toBe(before);
  });

  it('keeps it for a merge that fills it exactly', () => {
    const parser = createCommitLogParser(nothing);
    const before = parser.parents;
    const four = [NAME_B, NAME_C, NAME_D, NAME_E].join(' ');
    pushCommitLog(parser, bytesOf(commitRecord({ parents: four })));
    expect(parser.parents).toBe(before);
  });

  it('replaces it only for a merge wider than it', () => {
    const parser = createCommitLogParser(nothing);
    const before = parser.parents;
    const five = [NAME_A, NAME_B, NAME_C, NAME_D, NAME_E].join(' ');
    pushCommitLog(parser, bytesOf(commitRecord({ parents: five })));
    expect(parser.parents).not.toBe(before);
    expect(parser.parents.length).toBe(5 * HASH_BYTE_LENGTH);
  });
});

describe('pushCommitLog, over several records', () => {
  it('reads several commits from one stream', () => {
    const text = commitRecord() + commitRecord({ hash: NAME_B, subject: 'the second' });
    const commits = readCommits(text, 4096);
    expect(commits.map((commit) => commit.subject)).toEqual(['the first commit', 'the second']);
  });

  it('reads the same commits at every chunk size, down to one byte', () => {
    const text = commitRecord({ parents: NAME_B }) + commitRecord({ hash: NAME_B });
    const whole = readCommits(text, text.length + 1);
    for (let size = 1; size <= text.length + 1; size += 1) {
      expect(readCommits(text, size)).toEqual(whole);
    }
  });
});

describe('pushCommitLog, on text a user wrote', () => {
  it('keeps a subject holding a quotation mark, a tab and a backslash', () => {
    const subject = 'fix "the\tthing" in C:\\path';
    const [commit] = readCommits(commitRecord({ subject }), 4096);
    expect(commit?.subject).toBe(subject);
  });

  it('keeps a subject holding a newline', () => {
    const [commit] = readCommits(commitRecord({ subject: 'one\ntwo' }), 4096);
    expect(commit?.subject).toBe('one\ntwo');
  });

  it('keeps a subject holding a character outside the basic multilingual plane', () => {
    const [commit] = readCommits(commitRecord({ subject: `ship it ${CELEBRATION}` }), 4096);
    expect(commit?.subject).toBe('ship it 🎉');
  });

  it('lets a subject holding the unit separator absorb only itself', () => {
    const [commit] = readCommits(commitRecord({ subject: `before${UNIT}after` }), 4096);
    expect(commit?.authorName).toBe('Ada');
    expect(commit?.subject).toBe(`before${UNIT}after`);
  });

  it('lets a subject holding the record separator absorb only itself', () => {
    const [commit] = readCommits(commitRecord({ subject: `before${RECORD}after` }), 4096);
    expect(commit?.hash[0]).toBe(0x11);
    expect(commit?.subject).toBe(`before${RECORD}after`);
  });

  it('keeps an author whose name is not ASCII', () => {
    const name = String.fromCharCode(0xc3, 0xa9, 0x6c, 0xc3, 0xa8, 0x76, 0x65);
    const [commit] = readCommits(commitRecord({ authorName: name }), 4096);
    expect(commit?.authorName).toBe('élève');
  });
});

describe('pushCommitLog, on output that is not the format asked for', () => {
  it('refuses a record with the wrong number of fields', () => {
    expect(() => readCommits(`${RECORD}only${UNIT}two${NUL}`, 4096)).toThrow(SyntaxError);
  });

  it('says how many fields it wanted, even when the fields it did get are good', () => {
    expect(() => readCommits(`${RECORD}${NAME_A}${UNIT}${NUL}`, 4096)).toThrow(
      /a commit record has 9 fields, not 2/,
    );
  });

  it('refuses a record that does not begin with the record separator', () => {
    expect(() => readCommits(commitRecord().slice(1), 4096)).toThrow(SyntaxError);
  });
});

describe('finishCommitLog', () => {
  it('reads a last record that arrived without its terminator', () => {
    const text = commitRecord().slice(0, -1);
    expect(readCommits(text, 4096).map((commit) => commit.subject)).toEqual(['the first commit']);
  });
});
