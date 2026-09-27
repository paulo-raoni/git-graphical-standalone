import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRepository, readSpecification } from '../../fixtures/generate';

/**
 * The fixture repositories of the end-to-end suites that open repositories, and
 * the rules that let two runs on one machine share them.
 *
 * `open-repository.spec.ts`, `superseded-reply.spec.ts`, `stale-load-more.spec.ts`
 * and `open-scroll.spec.ts` build their repositories with the committed
 * generator, and the ten-thousand-commit one is worth building once rather than
 * once a case. So a repository no case writes into is **shared**: built under
 * {@link fixtureRoot}, one directory for the whole machine, named after a digest
 * of `specification.json` so a changed recipe builds elsewhere rather than
 * reusing a stale one. Every worktree, lane and review run on the machine reads
 * the same copy, which is what the two rules below are for. The directory is
 * not the `git-graphical-standalone-s06-` one the suites used before this
 * module: a checkout older than it still deletes and rebuilds repositories there
 * without a lock or a marker, and a different name keeps the two apart.
 *
 * **A shared repository is reused only once its build finished.** The generator
 * runs `git init` first and writes the history after it, so a build cut off
 * part-way — a run stopped by hand, a crash, a test timing out mid-write — leaves
 * a `.git` with no commit in it. A marker file beside the repository is written
 * after the generator returns, and a repository without a marker naming the same
 * recipe is rebuilt, never read. A marker was chosen over building into a
 * sibling directory and renaming it into place: renaming a directory on Windows
 * fails while any process still holds a handle inside it, and it does so with
 * the same `EPERM` as "the target exists" (both measured by E01-M01-FIX-18 with
 * `renameSync` on Node 24.18 and Windows 11), so a rename could not tell a
 * finished build it lost the race to from a transient refusal; and the unit
 * suite's own fixtures (`src/adapters/fixtures.spec-support.ts`) already use a
 * marker, so the project has one way to say "finished".
 *
 * **One run builds a missing repository while the others wait.** A lock file
 * beside the repository is created exclusively and names the process holding it.
 * A run that finds it held waits, and breaks it if the process it names is gone
 * or it is older than {@link LOCK_STALE_MS}, so a run killed while building costs
 * the next one a rebuild and not a wait or a failure. The broken lock is renamed
 * away before it is removed, and put back if what was renamed was not the lock
 * judged stale, which covers two waiters breaking the same lock at once.
 *
 * **A repository a case writes into is that run's own** ({@link ownFixture}):
 * built into a fresh `mkdtemp` directory no other run can name, and removed by
 * {@link removeOwnFixtures}, which each suite that makes one runs after every
 * case. A shared repository written into by one run is a repository changed
 * under another run's open window.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const specificationPath = join(repositoryRoot, 'test', 'fixtures', 'specification.json');
const recipe = createHash('sha256')
  .update(readFileSync(specificationPath))
  .digest('hex')
  .slice(0, 12);

/** Where the shared repositories live: one directory for every run on the machine. */
export const fixtureRoot = join(tmpdir(), `git-graphical-standalone-e2e-${recipe}`);

/**
 * How old a held lock may be before a waiting run breaks it although the process
 * it names still runs, which covers a process identifier the system has since
 * given to another program. E01-M01-FIX-18 timed three builds of the
 * ten-thousand-commit repository on the development machine on 2026-09-26, by
 * calling `generateRepository` from Node: 707, 870 and 744 ms. A holder this
 * old is two hundred times past that, and not building any more.
 */
const LOCK_STALE_MS = 180_000;

/** How long a run waits for a repository in all, which outlasts a stale lock. */
const PATIENCE_MS = LOCK_STALE_MS + 60_000;

/** How long a lock file may stay empty — created, not yet written — before it counts as stale. */
const UNWRITTEN_LOCK_MS = 10_000;

const POLL_MS = 100;

/** The private directories this process has made, removed by {@link removeOwnFixtures}. */
const own: string[] = [];

/** Sleep without a timer, which is the only way to wait inside synchronous code. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Build `name` into `directory`, with its clock started `laterBy` seconds after the recipe's. */
function build(
  directory: string,
  repository: { name: string; shape: string; commits: number },
  laterBy: number,
): void {
  const specification = readSpecification(specificationPath);
  generateRepository(directory, repository, {
    ...specification,
    firstSecond: specification.firstSecond + laterBy,
  });
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Whether the process a lock names is still running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Whether a lock holding `token` (read from `lock`) may be broken. */
function isStale(lock: string, token: string): boolean {
  const [pid, since] = token.split(' ').map(Number);
  if (pid === undefined || since === undefined || Number.isNaN(pid) || Number.isNaN(since)) {
    try {
      return Date.now() - statSync(lock).mtimeMs > UNWRITTEN_LOCK_MS;
    } catch {
      return false;
    }
  }
  return !isRunning(pid) || Date.now() - since > LOCK_STALE_MS;
}

/** Take `lock`, returning the token written into it, or `undefined` when another run holds it. */
function tryLock(lock: string): string | undefined {
  const token = `${String(process.pid)} ${String(Date.now())} ${randomUUID()}`;
  try {
    writeFileSync(lock, token, { flag: 'wx' });
    return token;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EPERM') {
      return undefined;
    }
    throw error;
  }
}

/** Remove `lock` if it still holds `token`, and leave it alone if another run holds it now. */
function unlock(lock: string, token: string): void {
  if (readIfPresent(lock) === token) {
    rmSync(lock, { force: true });
  }
}

/**
 * Break `lock`, judged stale while it held `judged`. It is renamed aside first,
 * so of two runs breaking it at once only one gets it; and if what was renamed
 * is not what was judged — another run broke it and took it in between — it is
 * linked back, which fails harmlessly if a third run holds the lock by then.
 */
function breakLock(lock: string, judged: string): void {
  const aside = `${lock}.${randomUUID()}`;
  try {
    renameSync(lock, aside);
  } catch {
    return;
  }
  if (readIfPresent(aside) !== judged) {
    try {
      linkSync(aside, lock);
    } catch {
      // Held by a third run already, which is a holder like any other.
    }
  }
  rmSync(aside, { force: true });
}

/** One wait for `lock`: break it if it is stale, otherwise sleep a little. */
function waitFor(lock: string): void {
  const token = readIfPresent(lock);
  if (token !== undefined && isStale(lock, token)) {
    breakLock(lock, token);
    return;
  }
  pause(POLL_MS);
}

/**
 * A repository shared by every run on the machine, built once. **Never write
 * into it**: use {@link ownFixture} for a case that does. `laterBy` starts its
 * clock that many seconds after the specification's, which changes every
 * object name and keeps every subject.
 */
export function fixture(name: string, shape: string, commits: number, laterBy = 0): string {
  const directory = join(fixtureRoot, name);
  const marker = `${directory}.finished`;
  const lock = `${directory}.lock`;
  const stamp = JSON.stringify({ shape, commits, laterBy });
  const finished = (): boolean =>
    readIfPresent(marker) === stamp && existsSync(join(directory, '.git'));
  mkdirSync(fixtureRoot, { recursive: true });
  const until = Date.now() + PATIENCE_MS;
  while (!finished()) {
    if (Date.now() > until) {
      throw new Error(`${directory} was never built: ${lock} stayed held`);
    }
    const token = tryLock(lock);
    if (token === undefined) {
      waitFor(lock);
      continue;
    }
    try {
      if (!finished()) {
        rmSync(marker, { force: true });
        build(directory, { name, shape, commits }, laterBy);
        writeFileSync(marker, stamp);
      }
    } finally {
      unlock(lock, token);
    }
  }
  return directory;
}

/**
 * A repository this run alone uses, for a case that writes into it: built into
 * a fresh directory under the system's temporary directory, and removed by
 * {@link removeOwnFixtures}.
 */
export function ownFixture(name: string, shape: string, commits: number): string {
  const parent = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-own-'));
  own.push(parent);
  const directory = join(parent, name);
  build(directory, { name, shape, commits }, 0);
  return directory;
}

/**
 * Remove every repository {@link ownFixture} made in this process. Retried,
 * because a git or Electron process that has just exited can hold a handle in
 * the directory for a moment on Windows.
 */
export function removeOwnFixtures(): void {
  for (const parent of own.splice(0)) {
    rmSync(parent, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
