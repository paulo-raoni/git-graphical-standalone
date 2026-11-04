import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { keptSelection } from '../contracts/index';
import type { BranchSelection } from '../contracts/index';
import { sayUnkept } from './window';

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
 *
 * **The file calls are synchronous**, as `./theme.ts` reads its file, and that is
 * a measured choice. The first asynchronous file call this process makes costs it
 * about 32 MiB of private memory for as long as it runs: measured by E03-M01-S12
 * on 2026-10-28 with the built application on a three-commit repository, the main
 * process read 67.6 to 71.6 MiB private twenty seconds after its first page with
 * the record read by `fs/promises`, and 35.7 to 38.6 MiB with it read by
 * `readFileSync` or not read at all, as at this slice's base (three launches each).
 * What the synchronous calls cost the window instead, measured the same day
 * through this module bundled on its own: a read of a record, or of one that is
 * not there, 0.05 to 0.77 ms over fifty of each, and 8 to 21 ms when the record
 * had been renamed into place a moment before (a scanner reading the new file is
 * an inference, not a measurement); a whole write, 1.11 to 2.02 ms over fifty.
 */

/** The folder the records are in, inside the user-data directory. */
const FOLDER = 'branch-selections';

/**
 * How many times a rename is tried, and how long apart, before the write is given
 * up as failed.
 *
 * **Windows refuses a rename over a file another process holds open**, and an
 * instance reading the record holds it open for the length of its read. Measured
 * by E03-M01-S12 on 2026-10-28 with two Node processes on Windows 11, one
 * renaming a fresh file over a record as fast as it could and the other reading
 * that record as fast as it could, for five seconds: 51 of 98 renames were refused
 * with `EPERM`, and none of 210 reads failed or read half a record. So a refused
 * rename is tried again; the reads need nothing.
 */
const RENAME_ATTEMPTS = 10;
const RENAME_PAUSE_MS = 20;

/** Rename `from` over `to`, trying again while it is refused, up to {@link RENAME_ATTEMPTS} times. */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error: unknown) {
      if (attempt === RENAME_ATTEMPTS) {
        throw error;
      }
      await delay(RENAME_PAUSE_MS);
    }
  }
}

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
        return keptSelection(JSON.parse(readFileSync(fileOf(path), 'utf8')));
      } catch {
        return null;
      }
    },
    keep: (path: string, selection: BranchSelection): Promise<void> => {
      const file = fileOf(path);
      const written = `${file}.${String(process.pid)}`;
      saved = saved
        .then(async () => {
          mkdirSync(folder, { recursive: true });
          writeFileSync(written, JSON.stringify(selection));
          // The line a whole record hinges on: until this rename, readers see the
          // previous record; after it, the new one, never a part of it.
          await replace(written, file);
        })
        .catch((error: unknown) => {
          // The selection holds in this window whatever happens here; what is
          // lost is that the next open will not find it. Said on the process's
          // own error stream, and in a message box over the window once per
          // run, as a theme that cannot be kept is (`./theme.ts`).
          process.stderr.write(`The branch selection could not be kept: ${String(error)}\n`);
          sayUnkept('branch selection', file);
        });
      return saved;
    },
  };
}
