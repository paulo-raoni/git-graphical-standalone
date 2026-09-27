import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRepository, readSpecification } from '../../fixtures/generate';

/**
 * The fixture repositories of the end-to-end suites that open repositories, and
 * the rules that let any number of runs on one machine share them.
 *
 * `open-repository.spec.ts`, `superseded-reply.spec.ts`, `stale-load-more.spec.ts`,
 * `open-scroll.spec.ts` and `refresh-control.spec.ts` build their repositories
 * with the committed generator, and the ten-thousand-commit one is worth building
 * once rather than once a case. So a repository no case writes into is
 * **shared**: published under {@link fixtureRoot}, one directory for the whole
 * machine, named after a digest of `specification.json` so a changed recipe
 * builds elsewhere rather than reusing a stale one. Every worktree, lane and
 * review run on the machine reads the same copy, which is what the next rule is
 * for.
 *
 * **No run ever builds into a directory another run can name.** A run that does
 * not find a repository published builds it into a staging directory of its
 * own, made by `mkdtemp` in {@link stagingRoot} with its process identifier in
 * the name, and then publishes it with one `renameSync` onto the shared
 * name. That rename is the only thing that creates a shared name, and it runs
 * after the generator returned, so a shared name that exists holds a finished
 * repository; a build cut off part-way — a run stopped by hand, a crash, a test
 * timing out mid-write — leaves only its own staging directory, which no run
 * reads. Several runs that start together may each build a copy. The first
 * rename wins; every later one is refused because the shared name exists, and
 * that run removes its copy and returns the winner's. There is no lock, so
 * there is nothing to wait for and nothing to break.
 *
 * A lost publish is told from a transient refusal by whether the shared name
 * exists after the refusal, not by the error. On Windows a rename onto an
 * existing directory, empty or not, and a rename of a directory inside which
 * another process holds a file or its working directory open fail with the
 * same `EPERM`, and a rename of a directory that is itself another process's
 * working directory fails with `EBUSY`; the target exists after the first and
 * not after the others (all of it measured by E01-M01-FIX-23 with `renameSync`
 * on Node 24.18 and Windows 11; E01-M01-FIX-18 had measured two of those cases
 * before it, a rename onto an existing directory and a rename of a directory
 * inside which a file is open, each failing with `EPERM`). A refusal
 * with the shared name still absent is retried for
 * {@link PUBLISH_PATIENCE_MS}, then thrown.
 *
 * The next run that builds removes every staging directory whose process no
 * longer runs. Only the process a staging directory names writes into it or
 * renames it, so removing one whose process is gone disturbs no build.
 *
 * The directory is not the `git-graphical-standalone-e2e-` one E01-M01-FIX-18
 * used, where a checkout of that code builds in place under a lock: a
 * different name keeps that protocol's files and this one's in different
 * directories.
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
export const fixtureRoot = join(tmpdir(), `git-graphical-standalone-e2e-shared-${recipe}`);

/**
 * Where the staging directories are made, each named `<process identifier>-`
 * and six random characters. No shared name can equal it, because every shared
 * name ends in `-` and a digest.
 */
const stagingRoot = join(fixtureRoot, '.staging');

/** How long a run retries a publish refused while the shared name is still absent. */
const PUBLISH_PATIENCE_MS = 60_000;

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

/**
 * Remove `directory`. Retried, because a git or Electron process that has just
 * exited can hold a handle in it for a moment on Windows.
 */
function remove(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** Whether the process `pid` names is still running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Remove the staging directories whose process no longer runs. One whose
 * identifier the system has since given to another running program is left
 * until that program exits. A removal that fails is left for a later run.
 */
function sweepStaging(): void {
  for (const entry of readdirSync(stagingRoot)) {
    const pid = Number(entry.split('-')[0]);
    if (Number.isInteger(pid) && !isRunning(pid)) {
      try {
        remove(join(stagingRoot, entry));
      } catch {
        // Still held open by something: left for the next run that builds.
      }
    }
  }
}

/**
 * Rename `staging` onto `directory`; or, when the rename is refused and
 * `directory` exists — another run published first — remove `staging`. A
 * refusal while `directory` is still absent is retried.
 */
function publish(staging: string, directory: string): void {
  const until = Date.now() + PUBLISH_PATIENCE_MS;
  for (;;) {
    try {
      renameSync(staging, directory);
      return;
    } catch (error) {
      if (existsSync(directory)) {
        try {
          remove(staging);
        } catch {
          // Left for the first run that builds after this process has exited.
        }
        return;
      }
      if (Date.now() > until) {
        throw error;
      }
      pause(POLL_MS);
    }
  }
}

/**
 * A repository shared by every run on the machine, published once. **Never
 * write into it**: use {@link ownFixture} for a case that does. `laterBy` starts its
 * clock that many seconds after the specification's, which changes every
 * object name and keeps every subject. The directory's name carries a digest of
 * the shape, the size and `laterBy`, so a call that asks for a different
 * repository under the same name gets a different directory.
 */
export function fixture(name: string, shape: string, commits: number, laterBy = 0): string {
  const stamp = JSON.stringify({ shape, commits, laterBy });
  const digest = createHash('sha256').update(stamp).digest('hex').slice(0, 8);
  const directory = join(fixtureRoot, `${name}-${digest}`);
  if (existsSync(directory)) {
    return directory;
  }
  mkdirSync(stagingRoot, { recursive: true });
  sweepStaging();
  const staging = mkdtempSync(join(stagingRoot, `${String(process.pid)}-`));
  build(staging, { name, shape, commits }, laterBy);
  publish(staging, directory);
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

/** Remove every repository {@link ownFixture} made in this process. */
export function removeOwnFixtures(): void {
  for (const parent of own.splice(0)) {
    remove(parent);
  }
}
