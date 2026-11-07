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
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
 * repository of each store and sees it: a tracked file removed or changed, a
 * file removed from the index alone, an untracked file removed or added, a branch or a tag moved or removed, `HEAD`
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
 * **A repository that differs is passed over, and another copy is used**: copy 1
 * is the published name itself, copy 2 is that name with `.2` appended, and so
 * on. Every copy that exists is checked, lowest number first, and the first that
 * matches its record is handed out; when none does, the copy numbered one past the
 * highest that exists is built and published under the rule below. So a number
 * below a copy that exists when a process lists them is never built again, and a
 * copy removed below the highest leaves a gap that nothing builds into
 * (`shared-store-copies.test.ts` holds both). A number is not reserved for good:
 * one is built again when a process lists the copies at a moment when no copy at
 * or above it exists. Review round 02 of E03-M01 read one such moment in this
 * code, and E04-M01-S07 did not measure it: a process lists the copies after
 * another has removed the only copy and before that one has published the next,
 * so it builds copy 1 again. A changed copy is reported on standard error, with
 * the first difference found, the first time a process passes over it. A copy that differs from its record
 * the moment it has been published is a defect of this check, not damage, and the
 * run fails at once rather than build another.
 *
 * **A changed copy is removed once no process it was handed to is running**, by
 * the first process that passes over it after that. A copy is handed out only
 * while it matches its record, so whoever may still be reading a changed one was
 * handed it before it changed. Beside each copy is a directory, its name with
 * {@link HANDED} appended, holding one empty file for each process the copy was
 * handed to, named by the process identifier and written before the check, so a
 * process deciding whether to remove the copy sees every process about to read
 * it. A file whose process has exited is removed by the next process that reads
 * the directory. An identifier the system has since given to another running
 * program keeps the copy until that program exits too. Removal waits for the
 * readers rather than for an age because no bound is known on how long a run
 * holds a path, and it does not happen while one runs because of what
 * E01-M01-FIX-33 measured, with Node 24.18 on Windows 11, two trials each (not
 * repeated by E03-M01-S05): while another process has its working directory in a
 * directory, a rename of it is refused with `EBUSY` and a recursive removal with
 * `EPERM`, removing nothing; while another process holds a file open in it, a
 * rename is refused with `EPERM` but a recursive removal succeeds and the
 * directory is gone; while nothing is held, which is a run between two of its git
 * processes, both succeed, and that run's next `git -C` fails with `cannot
 * change to`. A removal that fails is left for the next process that passes over.
 * What this cannot see is a process of code older than the rule, which writes no
 * file: a copy that changes while such a process reads it can be removed under it.
 *
 * **The stores of the protocol before E01-M01-FIX-33** (`ade2dd6`), published
 * whole and with no record, are removed by {@link removeOldStores}, which each
 * store calls when it loads. Only a checkout of code older than `ade2dd6` reads
 * them, and that code takes no lease, so nothing can say when none of its runs is
 * going. It is removed anyway, because that code builds a store it does not find
 * (read in `ade2dd6^`: the end-to-end store's `fixture` builds a repository it
 * does not find, the adapter suite's `ensureFixtures` the whole set), so what a
 * removal can cost is one red run of that old code, if one is going at that
 * moment and its git lands in the gap FIX-33 measured. No lane or review of this
 * milestone runs code that old; an old checkout run on purpose is safe with a
 * `TEMP` of its own.
 *
 * **What is not checked**: a repository is compared when it is asked for, and
 * not afterwards. A file removed while a case reads the repository is not seen by
 * that case, and is seen by the next ask.
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

/** The copies this process has been handed, whose files in their {@link HANDED} directory stay. */
const handedHere = new Set<string>();

/** What a copy's name is followed by to name the directory of the processes it was handed to. */
const HANDED = '.handed';

/** The stores of the protocol before E01-M01-FIX-33, by their names under the temporary directory. */
const OLD_STORE = /^git-graphical-standalone-(e2e|unit)-shared-[0-9a-f]{12}$/;

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

/** The numbers of the copies of `published` that exist, lowest first. */
function copiesOf(published: string): number[] {
  const base = basename(published);
  return readdirSync(dirname(published))
    .flatMap((entry) => {
      if (entry === base) {
        return [1];
      }
      const suffix = entry.startsWith(`${base}.`) ? entry.slice(base.length + 1) : '';
      return /^[1-9][0-9]*$/.test(suffix) && suffix !== '1' ? [Number(suffix)] : [];
    })
    .sort((one, other) => one - other);
}

/** Record that `copy` is being handed to this process, before it is checked. */
function takeLease(copy: string): void {
  mkdirSync(`${copy}${HANDED}`, { recursive: true });
  writeFileSync(join(`${copy}${HANDED}`, String(process.pid)), '');
}

/**
 * The running processes `copy` was handed to. The file of every process that has
 * exited is removed on the way; one that cannot be removed is left for the next.
 */
function runningHolders(copy: string): number[] {
  const leases = `${copy}${HANDED}`;
  const entries = existsSync(leases) ? readdirSync(leases) : [];
  return entries.flatMap((entry) => {
    const pid = Number(entry);
    if (Number.isInteger(pid) && isRunning(pid)) {
      return [pid];
    }
    try {
      unlinkSync(join(leases, entry));
    } catch {
      // Already removed by another process, or held: left for the next.
    }
    return [];
  });
}

/**
 * Pass over a changed `copy`: remove it when no process it was handed to runs,
 * and say so; otherwise leave it, and say so the first time.
 */
function passOver(copy: string, difference: string): void {
  if (!handedHere.has(copy)) {
    rmSync(join(`${copy}${HANDED}`, String(process.pid)), { force: true });
  }
  const said = `fixture ${copy} is not what was published: ${difference}.`;
  const holders = runningHolders(copy).length;
  if (holders === 0) {
    try {
      removeDirectory(copy);
      removeDirectory(`${copy}${HANDED}`);
      process.stderr.write(`${said} No process it was handed to runs, so it is removed.\n`);
      return;
    } catch {
      // Held open: left, and reported below, for the next process that passes over it.
    }
  }
  if (!reported.has(copy)) {
    reported.add(copy);
    const why =
      holders === 0
        ? 'its removal was refused'
        : `${String(holders)} process(es) it was handed to still run`;
    process.stderr.write(
      `${said} It is left as it is and not read, because ${why}; another copy is used.\n`,
    );
  }
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
  mkdirSync(dirname(published), { recursive: true });
  const copies = copiesOf(published);
  for (const copy of copies) {
    const candidate = copyName(published, copy);
    takeLease(candidate);
    const difference = differenceFrom(candidate);
    if (difference === undefined) {
      handedHere.add(candidate);
      return candidate;
    }
    passOver(candidate, difference);
  }
  const fresh = copyName(published, (copies.at(-1) ?? 0) + 1);
  buildAndPublish(fresh, stagingRoot, build);
  takeLease(fresh);
  const difference = differenceFrom(fresh);
  if (difference !== undefined) {
    throw new Error(`fixture ${fresh} differs from its record as soon as published: ${difference}`);
  }
  handedHere.add(fresh);
  return fresh;
}

/**
 * Remove the stores of the protocol before E01-M01-FIX-33 from
 * `temporaryDirectory`, the directory a store keeps its own under. One that
 * cannot be removed now is left for the next load.
 */
export function removeOldStores(temporaryDirectory: string): void {
  const entries = existsSync(temporaryDirectory) ? readdirSync(temporaryDirectory) : [];
  for (const entry of entries.filter((name) => OLD_STORE.test(name))) {
    try {
      removeDirectory(join(temporaryDirectory, entry));
    } catch {
      // Held by a run of the old code: left for the next load.
    }
  }
}
