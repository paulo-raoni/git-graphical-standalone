import { HASH_BYTE_LENGTH } from '../../contracts/index';
import type { CommitColumns, PersonTable } from '../../contracts/index';

import { entryAt } from './column-read';

/**
 * Reading a built page.
 *
 * Every function here takes the page as a parameter and keeps nothing. There is
 * no store object with methods and no module-level state
 * (`docs/ADR-0002-architecture-and-performance.md` decision 7), so the same
 * functions read a page built in this process and a page that arrived over the
 * IPC boundary as transferred buffers, with no rehydration step in between.
 *
 * Nothing here is eager. A page of fifty thousand commits is read by the renderer
 * a viewport at a time, so hex and subjects are produced for the rows on screen
 * and the rest of the page stays as bytes.
 */

/** One entry of the interned people table, materialised for a caller. */
export interface Person {
  readonly name: string;
  readonly email: string;
}

/** Commits in this page. */
export function commitCount(columns: CommitColumns): number {
  return columns.count;
}

/**
 * Fail on a row that is not in this page.
 *
 * A typed array answers an out-of-range read with `undefined`, and arithmetic on
 * `undefined` is `NaN`, which travels a long way before it becomes visible. This
 * turns that into an error at the call that caused it.
 *
 * @throws RangeError when `row` is not a whole number inside the page
 */
function assertRow(columns: CommitColumns, row: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= columns.count) {
    throw new RangeError(
      `row ${String(row)} is not a commit of a page of ${String(columns.count)}`,
    );
  }
}

/**
 * The object name of `row`, in hex.
 *
 * Produced here and stored nowhere. Forty characters per commit held for a
 * repository of fifty thousand is four megabytes of string that only a few dozen
 * visible rows ever need, which is why
 * `docs/ADR-0002-architecture-and-performance.md` decision 3 keeps the column
 * binary.
 */
export function hexHashOf(columns: CommitColumns, row: number): string {
  assertRow(columns, row);
  const start = row * HASH_BYTE_LENGTH;
  let hex = '';
  for (let byte = 0; byte < HASH_BYTE_LENGTH; byte += 1) {
    hex += entryAt(columns.hashes, start + byte)
      .toString(16)
      .padStart(2, '0');
  }
  return hex;
}

/** The subject of `row`, sliced out of the page's one message blob. */
export function subjectOf(columns: CommitColumns, row: number): string {
  assertRow(columns, row);
  return columns.subjects.slice(
    entryAt(columns.subjectOffsets, row),
    entryAt(columns.subjectOffsets, row + 1),
  );
}

/**
 * The parents of `row`, as rows of this page.
 *
 * A view over the flat parent column rather than a copy, so reading a merge's
 * parents allocates nothing. An entry is `UNKNOWN_INDEX` when that parent exists
 * in the repository but has not been loaded.
 */
export function parentsOf(columns: CommitColumns, row: number): Uint32Array {
  assertRow(columns, row);
  return columns.parentIndices.subarray(
    entryAt(columns.parentOffsets, row),
    entryAt(columns.parentOffsets, row + 1),
  );
}

/**
 * The person with this identifier.
 *
 * @throws RangeError when the identifier is not in the table, which would mean
 * the page's columns and its people table disagree
 */
function personAt(people: PersonTable, identifier: number): Person {
  const name = people.names[identifier];
  const email = people.emails[identifier];
  if (name === undefined || email === undefined) {
    throw new RangeError(
      `person ${String(identifier)} is not in a table of ${String(people.names.length)}`,
    );
  }
  return { name, email };
}

/** The author of `row`. */
export function authorOf(columns: CommitColumns, row: number): Person {
  assertRow(columns, row);
  return personAt(columns.people, entryAt(columns.authorId, row));
}

/** The committer of `row`. */
export function committerOf(columns: CommitColumns, row: number): Person {
  assertRow(columns, row);
  return personAt(columns.people, entryAt(columns.committerId, row));
}
