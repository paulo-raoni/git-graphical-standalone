import { execFileSync } from 'node:child_process';
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fixture repositories of this suite's own, and why they are not the ones under
 * `test/fixtures/repositories/`.
 *
 * That directory is **rebuilt in place** by the fixture generator's own test,
 * which deletes each repository and writes it again from its first commit. Vitest
 * runs test files in parallel, so a suite reading those repositories reads them
 * mid-rebuild: measured here first as a page that was missing its newest commits
 * and matched git on the older ones, which is exactly what half a rebuilt history
 * looks like and is not a shape any assertion would name.
 *
 * So this builds a copy somewhere else, by running the committed generator with
 * the root it takes as an argument. The copy lives under {@link home}, named
 * after a digest of `specification.json`, so it is reused between runs and a
 * change to the recipe produces a different directory rather than a stale one.
 * One copy serves every run of the fixture suite on the machine, which is what
 * the next rules are for.
 *
 * **No run ever builds into a directory another run can name.** A run that does
 * not find {@link fixtureRoot} makes a staging directory of its own with
 * `mkdtemp` in {@link stagingRoot}, its process identifier in the name, runs the
 * generator into it, and publishes it with one `renameSync` onto
 * {@link fixtureRoot}. That rename is the only thing that creates
 * {@link fixtureRoot}, and it runs after the generator returned, so a
 * {@link fixtureRoot} that exists holds a finished set; a run killed part-way —
 * its worker killed alone, a crash, a machine that stops — leaves only its own
 * staging directory, which no run reads. Several runs, or several workers of one
 * run, that start together may each build a copy. The first rename wins; every
 * later one is refused because {@link fixtureRoot} exists, and that run removes
 * its copy and uses the winner's. There is no lock, so there is nothing to wait
 * for and nothing a dead run can leave held.
 *
 * A lost publish is told from a transient refusal by whether {@link fixtureRoot}
 * exists after the refusal, not by the error. That is the rule of
 * `test/e2e/support/fixtures.ts`, and its reason holds here: on Windows a rename
 * onto an existing directory, empty or not, and a rename of a directory inside
 * which a file is open are refused with the same `EPERM`, the target existing
 * after the first two and not after the third (measured by E01-M01-FIX-26 with
 * `renameSync` on Node 24.18 and Windows 11, one trial each, as E01-M01-FIX-23
 * had measured before it). A refusal with {@link fixtureRoot} still absent is
 * retried for {@link PUBLISH_PATIENCE_MS}, then thrown.
 *
 * On Linux a rename onto a non-empty directory is refused with `ENOTEMPTY`, but
 * a rename onto an **empty** one replaces it (measured by E01-M01-FIX-26 with
 * `os.rename` in Python 3 on WSL Ubuntu, Linux 6.18, one trial each, as review
 * round 18 had measured before it). {@link fixtureRoot} is never an empty
 * directory: only this rename creates it, the directory renamed holds every
 * repository the generator wrote before it returned, and nothing here removes
 * anything inside it.
 *
 * Every call removes the staging directories whose process no longer runs. Only
 * the process a staging directory names renames it, so one whose process is gone
 * is never published. The generator is a child process of that one; where the
 * system does not end a child with its parent, a worker killed alone can leave
 * the generator writing into the dead worker's staging directory, and removing
 * that directory costs only a build nobody could publish. A removal that is
 * refused is left for a later call. A staging directory whose identifier the
 * system has since given to another running program is left until that program
 * exits.
 *
 * {@link home} is not the `git-graphical-standalone-fixtures-` directory an
 * older checkout builds into in place under a lock, so that protocol's files and
 * this one's never meet.
 *
 * This module is `.spec-support.ts` rather than `.spec.ts` on purpose: the
 * fixture suite matches `*.spec.ts`, and a helper collected as a suite of its own
 * is a suite with no tests in it.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The repository root, two directories above this file. */
const root = join(here, '..', '..');

const generator = join(root, 'test', 'fixtures', 'generate.ts');
const specification = join(root, 'test', 'fixtures', 'specification.json');

/** What the repositories were built from, so a changed recipe builds elsewhere. */
const recipe = createHash('sha256').update(readFileSync(specification)).digest('hex').slice(0, 12);

/** Everything this module keeps on the machine: the published set and the builds in progress. */
const home = join(tmpdir(), `git-graphical-standalone-unit-shared-${recipe}`);

/** Where this suite's repositories live, once a finished set has been published there. */
export const fixtureRoot = join(home, 'repositories');

/** Where each build happens, in a directory named `<process identifier>-` and six random characters. */
const stagingRoot = join(home, 'staging');

/** How long a run retries a publish refused while {@link fixtureRoot} is still absent. */
const PUBLISH_PATIENCE_MS = 60_000;

const POLL_MS = 100;

/** The path of one fixture repository, by the name the specification gives it. */
export function fixtureAt(name: string): string {
  return join(fixtureRoot, name);
}

/** Sleep without a timer, which is the only way to wait inside a synchronous hook. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Remove `directory`. Retried, because a git process that has just exited can
 * hold a handle in it for a moment on Windows.
 */
function remove(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

/** Remove the staging directories whose process no longer runs; a refused removal is left. */
function sweepStaging(): void {
  for (const entry of readdirSync(stagingRoot)) {
    const pid = Number(entry.split('-')[0]);
    if (Number.isInteger(pid) && !isRunning(pid)) {
      try {
        remove(join(stagingRoot, entry));
      } catch {
        // Still held open, by an orphaned generator for one: left for a later call.
      }
    }
  }
}

/**
 * Rename `staging` onto {@link fixtureRoot}; or, when the rename is refused and
 * {@link fixtureRoot} exists — another run published first — remove `staging`.
 * A refusal while {@link fixtureRoot} is still absent is retried.
 */
function publish(staging: string): void {
  const until = Date.now() + PUBLISH_PATIENCE_MS;
  for (;;) {
    try {
      renameSync(staging, fixtureRoot);
      return;
    } catch (error) {
      if (existsSync(fixtureRoot)) {
        try {
          remove(staging);
        } catch {
          // Left for the first call after this process has exited.
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

/** Build a whole set into a staging directory of this process's own, and return it. */
function build(): string {
  const staging = mkdtempSync(join(stagingRoot, `${String(process.pid)}-`));
  try {
    execFileSync(process.execPath, [generator, staging], { cwd: root, stdio: 'ignore' });
  } catch (error) {
    try {
      remove(staging);
    } catch {
      // Left for the first call after this process has exited.
    }
    throw error;
  }
  return staging;
}

/** Make sure a finished set is published at {@link fixtureRoot}, however many runs ask. */
export function ensureFixtures(): void {
  mkdirSync(stagingRoot, { recursive: true });
  sweepStaging();
  if (existsSync(fixtureRoot)) {
    return;
  }
  publish(build());
}

/**
 * Run git in a repository and return what it wrote, for comparison.
 *
 * This one names `git` bare and lets the environment's own `PATH` resolve it,
 * which is exactly what `git-executable.ts` refuses to do. That is deliberate:
 * this is the **independent witness** the adapter's answers are checked against,
 * and a witness that reached its git the same way the adapter does would agree
 * with it for the wrong reason.
 */
export function gitSays(repositoryPath: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8' });
}

/** The non-empty lines of what git wrote. */
export function gitLines(repositoryPath: string, args: readonly string[]): string[] {
  return gitSays(repositoryPath, args)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * The hex object name of one row of a page.
 *
 * Produced here rather than borrowed: the decoders of `CommitColumns` are being
 * moved out of `src/core/store/` by another lane of this same wave, and a test
 * that compares a page against git should not depend on the page's own reader
 * anyway.
 */
export function hexAt(hashes: Uint8Array, row: number, width: number): string {
  let text = '';
  for (let byte = 0; byte < width; byte += 1) {
    text += (hashes[row * width + byte] ?? 0).toString(16).padStart(2, '0');
  }
  return text;
}

/** The name of reference `index` of a built `Refs` block. */
export function refNameAt(names: string, offsets: Uint32Array, index: number): string {
  return names.slice(offsets[index] ?? 0, offsets[index + 1] ?? 0);
}
