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
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * What the two stores of shared fixture repositories have in common: how a
 * repository is published, the record of what it was when it was published, and
 * the check of a published repository against that record before it is handed
 * out. `test/e2e/support/fixtures.ts` and `src/adapters/fixtures.spec-support.ts`
 * are the two stores; each says in its own header which repositories it shares
 * and where.
 *
 * **A published repository can change after it is published**, and nothing that
 * reads it notices. On the development machine both stores once held
 * repositories whose working-tree files had been removed (E01-M01-S11, *A
 * damaged fixture cache, met on the way*), and a suite that compares the adapter
 * with git on the same repository agrees with itself on a changed one: review
 * round 21 removed a tracked file from a shared `branch-and-merge` and every case
 * that reads it stayed green, and E01-M01-FIX-33 reproduced that, and a moved
 * branch left green the same way. So a repository is handed out only after it
 * has been compared with its record, and one that differs is never handed out.
 *
 * **The record** is written into the repository's `.git`, as {@link RECORD},
 * after the generator returned and before the one rename that publishes it, so a
 * published repository either has its record or was not published by this code.
 * It holds a SHA-256 digest of every file of the repository, the working tree and
 * `.git` both, by its path relative to the repository, and a digest of what
 * `git ls-files --stage` lists. `shared-store.test.ts` makes each of these to a
 * repository of each store and sees it: a tracked file removed or changed, an
 * untracked file removed or added, a branch or a tag moved or removed, `HEAD`
 * moved, the stash dropped, a loose object removed, a pack rewritten, the record
 * removed. Two kinds of path are left out, because a reader writes them without
 * changing what the repository holds: `.git/index`, which `git status` writes
 * back (E01-M01-FIX-33 saw it move the file's time in five of eight trials on
 * freshly published repositories, with the same bytes each time; that its cached
 * file times can also change the bytes is an inference from what the index
 * caches), and every `*.lock` file, which a running git makes and removes. What
 * the index holds is what `ls-files` lists. A repository whose record is missing
 * or unreadable counts as changed.
 *
 * **A repository that differs is left where it is, and the next copy is used**:
 * copy 1 is the published name itself, copy 2 is that name with `.2` appended,
 * and so on. The first copy that matches its record is handed out; the first that
 * does not exist is built and published under the rule below. No run removes or
 * renames a published copy, changed or not, because another run may be reading
 * it. E01-M01-FIX-33 measured, with Node 24.18 on Windows 11, two trials each:
 * while another process has its working directory in a directory, a rename of it
 * is refused with `EBUSY` and a recursive removal with `EPERM`, removing nothing;
 * while another process holds a file open in it, a rename is refused with `EPERM`
 * but a recursive removal succeeds and the directory is gone; while nothing is
 * held, which is a run between two of its git processes, both succeed, and that
 * run's next `git -C` fails with `cannot change to`. A changed copy is reported
 * on standard error, with the first difference found, the first time a process
 * passes over it. A copy that differs from its record the moment it has been
 * published is a defect of this check, not damage, and the run fails at once
 * rather than build another.
 *
 * **What is not checked**: a repository is compared when it is asked for, and
 * not afterwards. A file removed while a case reads the repository is not seen by
 * that case, and is seen by the next ask. Changed copies are never removed by a
 * run, so each one stays on disk until someone removes it with no run going.
 *
 * **No run ever builds into a directory another run can name.** A run builds into
 * a staging directory of its own, made by `mkdtemp` with its process identifier
 * in the name, writes the record there, and publishes it with one `renameSync`.
 * A build cut off part-way leaves only its own staging directory, which no run
 * reads. Several runs that start together may each build a copy; the first
 * rename wins, every later one is refused because the name exists, and that run
 * removes its copy and checks the winner's. There is no lock. (E01-M01-FIX-33
 * started two processes together on one changed copy three times: each time both
 * built, both were handed the same next copy, matching its record, and no staging
 * directory was left.) A lost publish is told from a transient refusal by whether
 * the name exists after the refusal, not by the error: on Windows a rename onto an
 * existing directory and a rename of a directory inside which another process
 * holds a file open both fail with `EPERM` (measured by E01-M01-FIX-23 and
 * E01-M01-FIX-26 with `renameSync` on Node 24.18 and Windows 11, and the second
 * again by E01-M01-FIX-33). A refusal with the name still absent is retried for
 * {@link PUBLISH_PATIENCE_MS}, then thrown. The next run that builds removes every
 * staging directory whose process no longer runs.
 */

/** The record of a published repository, inside its `.git`, under a name git does not use. */
const RECORD = 'published-state.json';

/** How long a run retries a publish refused while the name is still absent. */
const PUBLISH_PATIENCE_MS = 60_000;

const POLL_MS = 100;

/** The changed copies this process has already reported, so that each is reported once. */
const reported = new Set<string>();

/** What a repository is, as digests by name: one per file, and one for the index. */
type State = Record<string, string>;

/** The name the index's digest is recorded under; no file of a repository has a space-led name. */
const INDEX = ' the index, as git ls-files --stage lists it';

/** Sleep without a timer, which is the only way to wait inside synchronous code. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Remove `directory`. Retried, because a git or Electron process that has just
 * exited can hold a handle in it for a moment on Windows.
 */
export function removeDirectory(directory: string): void {
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
function sweepStaging(stagingRoot: string): void {
  for (const entry of readdirSync(stagingRoot)) {
    const pid = Number(entry.split('-')[0]);
    if (Number.isInteger(pid) && !isRunning(pid)) {
      try {
        removeDirectory(join(stagingRoot, entry));
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
          removeDirectory(staging);
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

function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Whether a path, relative to the repository with `/` between names, is left out of the record. */
function leftOut(path: string): boolean {
  return path === '.git/index' || path === `.git/${RECORD}` || path.endsWith('.lock');
}

/** Add every file under `relative` to `state`, by its path relative to `repository`. */
function addFiles(state: State, repository: string, relative: string): void {
  for (const entry of readdirSync(join(repository, relative), { withFileTypes: true })) {
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      addFiles(state, repository, path);
    } else if (!leftOut(path)) {
      state[path] = digestOf(readFileSync(join(repository, path)));
    }
  }
}

/** What `repository` is now. Throws when git or the file system cannot read it. */
function stateOf(repository: string): State {
  const index = execFileSync(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repository, 'ls-files', '-sz'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const state: State = { [INDEX]: digestOf(index) };
  addFiles(state, repository, '');
  return state;
}

/** The record `repository` was published with, or `undefined` when it has none it can read. */
function recordOf(repository: string): State | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(repository, '.git', RECORD), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as State) : undefined;
  } catch {
    return undefined;
  }
}

function firstLine(error: unknown): string {
  return String(error instanceof Error ? error.message : error).split('\n')[0] ?? '';
}

/** One entry's difference, said in words. */
function described(name: string, was: string | undefined, is: string | undefined): string {
  const what = name === INDEX ? name.trim() : name;
  if (was === undefined) {
    return `${what} was not there when it was published`;
  }
  return is === undefined ? `${what} has gone` : `${what} has changed`;
}

/**
 * The first way `repository` differs from the record it was published with, in
 * words, or `undefined` when it does not differ.
 */
export function differenceFrom(repository: string): string | undefined {
  const record = recordOf(repository);
  if (record === undefined) {
    return `it has no readable record (${RECORD}) of what was published`;
  }
  let now: State;
  try {
    now = stateOf(repository);
  } catch (error) {
    return `it cannot be read: ${firstLine(error)}`;
  }
  const names = [...new Set([...Object.keys(record), ...Object.keys(now)])].sort();
  const changed = names.find((name) => record[name] !== now[name]);
  return changed === undefined ? undefined : described(changed, record[changed], now[changed]);
}

/** Build into a staging directory of this process's own, record it, and publish it as `directory`. */
function buildAndPublish(
  directory: string,
  stagingRoot: string,
  build: (staging: string) => void,
): void {
  mkdirSync(stagingRoot, { recursive: true });
  sweepStaging(stagingRoot);
  const staging = mkdtempSync(join(stagingRoot, `${String(process.pid)}-`));
  try {
    build(staging);
    writeFileSync(join(staging, '.git', RECORD), `${JSON.stringify(stateOf(staging), null, 1)}\n`);
  } catch (error) {
    try {
      removeDirectory(staging);
    } catch {
      // Left for the first run that builds after this process has exited.
    }
    throw error;
  }
  publish(staging, directory);
}

/** Copy `copy` of `published`: the name itself, then the name with `.2`, `.3` and on appended. */
function copyName(published: string, copy: number): string {
  return copy === 1 ? published : `${published}.${String(copy)}`;
}

/**
 * The path of the first copy of `published` that matches its record, building
 * and publishing the next copy with `build` when every existing one differs.
 * `build` writes one repository into the empty directory it is given.
 */
export function verifiedCopy(
  published: string,
  stagingRoot: string,
  build: (directory: string) => void,
): string {
  for (let copy = 1; ; copy += 1) {
    const candidate = copyName(published, copy);
    const fresh = !existsSync(candidate);
    if (fresh) {
      buildAndPublish(candidate, stagingRoot, build);
    }
    const difference = differenceFrom(candidate);
    if (difference === undefined) {
      return candidate;
    }
    if (fresh) {
      throw new Error(
        `fixture ${candidate} differs from its record as soon as published: ${difference}`,
      );
    }
    if (!reported.has(candidate)) {
      reported.add(candidate);
      process.stderr.write(
        `fixture ${candidate} is not what was published: ${difference}. ` +
          `It is left as it is and not read; the next copy is used.\n`,
      );
    }
  }
}
