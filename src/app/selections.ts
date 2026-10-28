import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { keptSelection } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';

/**
 * The branch selection last applied to each repository, kept by the main process
 * across restarts and between instances of the application on one user-data
 * directory.
 *
 * **In files under the user-data directory, written by this process**, as
 * `./theme.ts` keeps the theme, and not in the renderer's own storage: a second
 * instance on the same directory finds the browser profile held by the first, and
 * cannot read that storage at all (measured by E03-M01-S10). A file is read by
 * whichever process opens it.
 *
 * **One file per repository**, in the folder {@link FOLDER}, named by the SHA-256
 * of the path the repository was opened by, so that two instances writing two
 * repositories never write the same file, whatever the paths' characters or
 * length. Two instances writing one repository: the last write wins. The file
 * holds the selection as JSON, its two fields and nothing else.
 *
 * **A write never leaves a half-written record.** It writes a file of its own
 * beside the record, named by this process's id so that two instances never share
 * one, and renames it over the record: a reader finds the old record or the new
 * one, whole. Writes are chained, so the record ends holding the last selection
 * this instance applied.
 *
 * **A record is read at each open**, not once at start, which is what lets one
 * instance open on what another applied. What is read is checked by
 * `keptSelection` (`src/contracts/kept-selection.ts`); a record that is missing,
 * unreadable or not one this application wrote is nothing kept.
 */

/** The folder the records are in, inside the user-data directory. */
const FOLDER = 'branch-selections';

/** The selections kept, by the path each repository was opened by. */
export interface SelectionStore {
  /** The selection kept for `path`, or `null` when nothing usable is kept. */
  readonly read: (path: string) => Promise<BranchSelection | null>;
  /** Keep `selection` for `path`, and settle once it is on the disk or could not be. */
  readonly keep: (path: string, selection: BranchSelection) => Promise<void>;
}

/** @param directory the application's user-data directory */
export function openSelectionStore(directory: string): SelectionStore {
  const folder = join(directory, FOLDER);
  const fileOf = (path: string): string =>
    join(folder, createHash('sha256').update(path).digest('hex'));
  let saved: Promise<void> = Promise.resolve();

  return {
    read: async (path: string): Promise<BranchSelection | null> => {
      // After this instance's own writes, so an open reads what it applied last.
      await saved;
      try {
        return keptSelection(JSON.parse(await readFile(fileOf(path), 'utf8')));
      } catch {
        return null;
      }
    },
    keep: (path: string, selection: BranchSelection): Promise<void> => {
      const file = fileOf(path);
      const written = `${file}.${String(process.pid)}`;
      saved = saved
        .then(async () => {
          await mkdir(folder, { recursive: true });
          await writeFile(written, JSON.stringify(selection));
          // The line a whole record hinges on: until this rename, readers see the
          // previous record; after it, the new one, never a part of it.
          await rename(written, file);
        })
        .catch((error: unknown) => {
          // The selection holds in this window whatever happens here; what is
          // lost is that the next open will not find it. Said on the process's
          // own error stream, as a theme that cannot be kept is (`./theme.ts`).
          process.stderr.write(`The branch selection could not be kept: ${String(error)}\n`);
        });
      return saved;
    },
  };
}
