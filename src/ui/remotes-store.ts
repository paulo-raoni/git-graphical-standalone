/**
 * Show Remote Branches, remembered per repository in this renderer's own
 * IndexedDB, keyed by the path the repository was opened by.
 *
 * **Why IndexedDB and not `localStorage`.** Both live in the browser profile in
 * the application's user-data directory, and a second instance of the
 * application on the same directory finds the profile held by the first.
 * Measured by E03-M01-S10 on 2026-10-28 with the built application, a second
 * instance launched beside a first: its first `localStorage` call blocked the
 * page for 5 440 ms (3 ms with no first instance), freezing the whole window,
 * while IndexedDB answered with an error after 5 873 and 5 927 ms without
 * blocking anything. Either way the second instance cannot read what is
 * stored; only IndexedDB lets it go on drawing while it finds out, which is what
 * lets `./renderer.ts` open the repository without waiting for the answer.
 *
 * Nothing here throws to its caller: a store that cannot be opened or read
 * answers `null`, and a choice that cannot be written is simply not remembered.
 */

const DATABASE = 'git-graphical-standalone';
const STORE = 'show-remote-branches';

let opened: Promise<IDBDatabase | null> | null = null;

/** The database, opened once; a failed open is tried again by the next call. */
function database(): Promise<IDBDatabase | null> {
  opened ??= new Promise((done) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => {
      done(request.result);
    };
    request.onerror = (): void => {
      opened = null;
      done(null);
    };
  });
  return opened;
}

/** The remembered choice for `path`, or `null` when none is stored or the store cannot answer. */
export async function readRemotes(path: string): Promise<boolean | null> {
  const db = await database();
  return new Promise((done) => {
    if (db === null) {
      done(null);
      return;
    }
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(path);
      request.onsuccess = (): void => {
        done(typeof request.result === 'boolean' ? request.result : null);
      };
      request.onerror = (): void => {
        done(null);
      };
    } catch {
      done(null);
    }
  });
}

/** Remember `show` for `path`, if the store can be written. */
export function storeRemotes(path: string, show: boolean): void {
  void database().then((db) => {
    try {
      db?.transaction(STORE, 'readwrite').objectStore(STORE).put(show, path);
    } catch {
      // Not remembered: the choice still holds until the repository is closed.
    }
  });
}
