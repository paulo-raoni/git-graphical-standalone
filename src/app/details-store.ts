import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_DETAILS_LAYOUT,
  DEFAULT_DETAILS_OPTIONS,
  keptDetailsLayout,
  keptDetailsOptions,
} from '../contracts/index';
import type { DetailsLayout, DetailsOptions } from '../contracts/index';
import { writeRecord } from './selections';

/**
 * What the Commit Details View keeps across restarts (E04-M01-S12): the options,
 * which are the application's, and each repository's layout.
 *
 * **In files under the user-data directory, written by this process**, exactly as
 * `./selections.ts` keeps the branch selection and for its reason, which that
 * module argues: a second instance on the same directory cannot read the
 * renderer's storage, and the file calls are synchronous because the first
 * asynchronous one costs this process about 32 MiB (E03-M01-S12's measurement,
 * not reproduced here). One file `details-options` holds the options. One file per
 * repository, in the folder `details-layouts`, holds its layout, named by the
 * SHA-256 of the path the repository was opened by: the path is only ever hashed,
 * never joined to a directory. Each holds its value as JSON and nothing else.
 *
 * The options are read once, here, when the store is opened, and a layout at each
 * open, so one instance opens on what another kept. What is read is checked by
 * `src/contracts/details-layout.ts`; a record that is missing, unreadable or not
 * one this application wrote is nothing kept, and the defaults apply. Writes are
 * chained, so each record ends holding the last value this instance applied.
 */

const OPTIONS_FILE = 'details-options';
const LAYOUTS_FOLDER = 'details-layouts';

/** The options in force and the layouts kept. */
export interface DetailsStore {
  /** The options in force: the kept ones, or the defaults. */
  readonly options: () => DetailsOptions;
  /**
   * Apply `requested` when it is options this application writes, and keep it.
   * Answers the options in force, which are unchanged when it is refused.
   */
  readonly choose: (requested: unknown) => Promise<DetailsOptions>;
  /** The layout kept for `path`, or the defaults. Read from the disk at each call. */
  readonly layout: (path: string) => DetailsLayout;
  /** Keep `layout` for `path` when both are what the page may send; answers whether it was. */
  readonly keep: (path: unknown, layout: unknown) => Promise<DetailsLayout | null>;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** @param directory the application's user-data directory */
export function openDetailsStore(directory: string): DetailsStore {
  const optionsFile = join(directory, OPTIONS_FILE);
  const folder = join(directory, LAYOUTS_FOLDER);
  const fileOf = (path: string): string =>
    join(folder, createHash('sha256').update(path).digest('hex'));
  let options = keptDetailsOptions(readJson(optionsFile)) ?? DEFAULT_DETAILS_OPTIONS;
  let saved: Promise<void> = Promise.resolve();

  return {
    options: (): DetailsOptions => options,
    choose: async (requested: unknown): Promise<DetailsOptions> => {
      const checked = keptDetailsOptions(requested);
      if (checked === null) {
        return options;
      }
      options = checked;
      saved = saved.then(() => writeRecord(directory, optionsFile, checked, 'details options'));
      await saved;
      return checked;
    },
    layout: (path: string): DetailsLayout =>
      keptDetailsLayout(readJson(fileOf(path))) ?? DEFAULT_DETAILS_LAYOUT,
    keep: async (path: unknown, layout: unknown): Promise<DetailsLayout | null> => {
      const checked = keptDetailsLayout(layout);
      if (typeof path !== 'string' || path === '' || checked === null) {
        return null;
      }
      const file = fileOf(path);
      saved = saved.then(() => writeRecord(folder, file, checked, 'details layout'));
      await saved;
      return checked;
    },
  };
}
