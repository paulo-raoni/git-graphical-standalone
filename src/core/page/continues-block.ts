import { entryAt } from '../../contracts/column-read';
import { HASH_BYTE_LENGTH } from '../../contracts/index';
import type { CommitColumns } from '../../contracts/index';

import type { RowBlock } from './row-block';

/**
 * Whether a new reading of a repository may be appended to the rows already laid
 * out, or has to be laid out again from nothing.
 *
 * A further page is read by asking for the whole page again, larger, and only
 * the rows past the block are laid out and appended
 * (`docs/plan/E01-commit-graph/M01-first-graph/S06-open-a-repository.md`, *How a
 * further page is read*). That is correct exactly when the first
 * `block.rowCount` commits of the new reading are the commits the block's rows
 * were laid out for, in the same order. Anything that moves the log between the
 * two reads — a commit, a fetch, a new branch, a rebase — breaks it, and the
 * append would then put new rows under a prefix laid out for a history that is
 * no longer the one on screen, which is a wrong graph that looks like a right
 * one.
 *
 * **Why comparing object names is enough.** An object name is a digest of the
 * commit, parents included, so the same names in the same order are the same
 * commits with the same parents. Each parent is then at the same position of the
 * new reading if it was inside the prefix, and past the prefix if it was not —
 * which is the shape an appended page has, and the one `layoutPage` resolves the
 * lanes left waiting for it against. What the block's rows were laid out from
 * is therefore described completely by those names.
 *
 * **What it is compared against is the `hashes` column of the reading the block
 * was laid out from**, kept by the caller beside the block, and neither a copy of
 * it nor the whole reading. The column is a view of a buffer the store sized to
 * the page asked for, so holding it costs twenty bytes a commit asked for and
 * nothing is copied to keep it; holding the whole reading would keep every other
 * column of it, the subjects included, for the sake of one. The measured bytes,
 * and what the comparison costs beside the read a press already pays, are in
 * S06's slice document under *How a further page is read*.
 */

/**
 * Whether `reading` continues the block laid out from the object names
 * `laidOutFrom`: its first `block.rowCount` object names are those, in order.
 *
 * `laidOutFrom` is the `CommitColumns.hashes` of the reading the block's rows
 * were laid out from, `HASH_BYTE_LENGTH` bytes a commit. A reading shorter than
 * the block does not continue it, and nor does a `laidOutFrom` too short to
 * cover the block, because either would leave rows whose commit is not known.
 * An empty block is continued by every reading.
 */
export function continuesBlock(
  block: RowBlock,
  laidOutFrom: Uint8Array,
  reading: CommitColumns,
): boolean {
  const prefixBytes = block.rowCount * HASH_BYTE_LENGTH;
  if (reading.hashes.length < prefixBytes || laidOutFrom.length < prefixBytes) {
    return false;
  }
  for (let at = 0; at < prefixBytes; at += 1) {
    if (entryAt(reading.hashes, at) !== entryAt(laidOutFrom, at)) {
      return false;
    }
  }
  return true;
}
