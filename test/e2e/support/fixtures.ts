import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElectronApplication } from '@playwright/test';

import { generateRepository, readSpecification } from '../../fixtures/generate';
import { removeDirectory, removeOldStores, verifiedCopy } from '../../fixtures/shared-store';

/**
 * The fixture repositories of the end-to-end suites that open repositories, and
 * the rules that let any number of runs on one machine share them; and, at the
 * end, {@link withOwnProfile}, which launches the application on a user-data
 * directory of its own.
 *
 * `open-repository.spec.ts`, `superseded-reply.spec.ts`, `stale-load-more.spec.ts`,
 * `open-scroll.spec.ts` and `refresh-control.spec.ts` build their repositories
 * with the committed generator, and the ten-thousand-commit one is worth building
 * once rather than once a case. So a repository no case writes into is
 * **shared**: published under {@link fixtureRoot}, one directory for the whole
 * machine, named after a digest of `specification.json` so a changed recipe
 * builds elsewhere rather than reusing a stale one. Every worktree, lane and
 * review run on the machine reads the same copy.
 *
 * **What is verified, and when.** Every call of {@link fixture} compares the
 * published repository with the record written when it was published, before it
 * returns the path, and never returns one that differs: a changed repository is
 * left in place, unread, and the next copy is used or built. What the record
 * holds, how a repository is published, and why no run removes or renames a
 * published copy are the rules of `test/fixtures/shared-store.ts`, which the
 * adapter suite's store shares. **What is not verified** is a repository after
 * its path has been returned: a file removed while a case has the repository
 * open is not seen by that case. The check runs before a case launches or times
 * anything, so no budget's window holds it.
 *
 * The directory is not the `git-graphical-standalone-e2e-shared-` one the code
 * before E01-M01-FIX-33 published into, whose repositories carry no record; nor
 * the `git-graphical-standalone-e2e-` one E01-M01-FIX-18 used. Different names
 * keep each protocol's files in different directories. The first of them is
 * removed when this module loads, by `removeOldStores` of
 * `test/fixtures/shared-store.ts`, which says why that is safe.
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
export const fixtureRoot = join(tmpdir(), `git-graphical-standalone-e2e-verified-${recipe}`);

/**
 * Where the staging directories are made, each named `<process identifier>-`
 * and six random characters. No shared name can equal it, because every shared
 * name ends in `-` and a digest, or in that and a copy number.
 */
const stagingRoot = join(fixtureRoot, '.staging');

removeOldStores(tmpdir());

/** The private directories this process has made, removed by {@link removeOwnFixtures}. */
const own: string[] = [];

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
 * A repository shared by every run on the machine, published once and checked
 * against its record at every call. **Never write into it**: use
 * {@link ownFixture} for a case that does. `laterBy` starts its clock that many
 * seconds after the specification's, which changes every object name and keeps
 * every subject. The directory's name carries a digest of the shape, the size and
 * `laterBy`, so a call that asks for a different repository under the same name
 * gets a different directory.
 */
export function fixture(name: string, shape: string, commits: number, laterBy = 0): string {
  const stamp = JSON.stringify({ shape, commits, laterBy });
  const digest = createHash('sha256').update(stamp).digest('hex').slice(0, 8);
  return verifiedCopy(join(fixtureRoot, `${name}-${digest}`), stagingRoot, (directory) => {
    build(directory, { name, shape, commits }, laterBy);
  });
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
    removeDirectory(parent);
  }
}

/**
 * Fail unless `child` has exited: a leaked process is a failure of the gate
 * whatever the assertions said.
 */
function requireExited(child: ChildProcess): void {
  if (child.exitCode === null && !child.killed) {
    throw new Error('the application was asked to close and its process is still running');
  }
}

/** What {@link withOwnProfile} launches with: a folder to open, and an environment. */
export interface Launch {
  /** The folder named on the command line, or none for the empty window. */
  readonly open?: string;
  /** The whole environment of the application, or this process's when absent. */
  readonly env?: Record<string, string>;
}

/**
 * Launch the built application on a user-data directory of its own, run `body`
 * against it, stop it, require its process gone, and remove the directory.
 *
 * **Why every suite of the `application` project launches through this.** The
 * application keeps what a person chose under its user-data directory: the theme
 * in a file `theme` (`src/app/theme.ts`) and a branch selection per repository in
 * a folder `branch-selections` (`src/app/selections.ts`), and it reads the theme
 * back at every start and a repository's selection at every open. Launched with
 * no `--user-data-dir`, it uses the profile of whoever runs the suite, so a
 * choice that person left there carries into the run, and a selection a case
 * applies is kept in their profile after it. A directory of its own per launch
 * keeps both out: nothing is read that the case did not put there, and nothing it
 * keeps outlives it.
 *
 * **The line the isolation hinges on** is the `--user-data-dir` argument below.
 * No case reads which profile it ran on, so a suite launched without it again
 * stays green: E04-M01-S04 put `branch-selection.spec.ts` back on the default
 * profile, and the suite passed while that profile's `branch-selections` folder
 * was written. What holds the isolation is a digest of the default profile taken
 * before and after a full `npm run gates:e2e`, as that slice's audit records. A
 * launch that does not come through here — a second `electron.launch` written
 * into a case, or an instance the case starts by itself — is not covered by this
 * function, and only that digest would show it.
 *
 * **Nothing is removed under a running application.** A profile removed while
 * the application still runs makes its next write fail, and a failed write
 * raises a *Not kept* message box (`sayUnkept`, `src/app/window.ts`). So the
 * directory goes only after the process has exited ({@link ended}), never from a
 * hook that runs beside a case Playwright stopped waiting for; and every
 * message box the application asks for while the case runs is held and recorded
 * instead of shown ({@link holdMessageBoxes}), and fails the case.
 *
 * The directory is made fresh for each launch under the system's temporary
 * directory and removed once the process has exited, whatever `body` did; a case
 * that needs two launches to share one profile (a choice kept across a restart)
 * passes `--user-data-dir` itself, as `theme.spec.ts` and `selection-kept.spec.ts`
 * do. Playwright is imported here when the launch is asked for, not when the
 * module loads, because the Vitest suites of `perf/` and `test/fixtures/` import
 * this module for {@link fixture} and run no Playwright at all.
 */
export async function withOwnProfile<T>(
  launch: Launch,
  body: (application: ElectronApplication) => Promise<T>,
): Promise<T> {
  const { _electron: electron } = await import('@playwright/test');
  const home = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-profile-'));
  let child: ChildProcess | undefined;
  try {
    const args = ['.', ...(launch.open === undefined ? [] : [launch.open])];
    const application = await electron.launch({
      args: [...args, `--user-data-dir=${home}`],
      cwd: repositoryRoot,
      ...(launch.env === undefined ? {} : { env: launch.env }),
    });
    // Taken before the close, because `process()` reaches through a connection
    // that closing tears down.
    child = application.process();
    try {
      await application.evaluate(holdMessageBoxes);
      const value = await body(application);
      requireNoMessageBox(await application.evaluate(readMessageBoxes));
      return value;
    } finally {
      await application.close();
      requireExited(child);
    }
  } finally {
    // The line the teardown's order hinges on: the directory goes only once the
    // process that could still write into it has ended.
    if (child !== undefined) await ended(child);
    removeDirectory(home);
  }
}

/** How long {@link ended} waits for the application to exit before it stops it. */
const EXIT_WAIT_MS = 10_000;

/**
 * Settle once `child` has exited, stopping it if it has not within
 * {@link EXIT_WAIT_MS}: it is this run's own process, launched by
 * {@link withOwnProfile}, and its profile is about to be removed.
 */
async function ended(child: ChildProcess): Promise<void> {
  const gone = (): boolean => child.exitCode !== null || child.signalCode !== null;
  const exit = (within: number): Promise<void> =>
    new Promise((resolve) => {
      if (gone()) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, within);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  await exit(EXIT_WAIT_MS);
  if (!gone()) {
    child.kill();
    await exit(EXIT_WAIT_MS);
  }
}

/** The main-process side of {@link holdMessageBoxes}: the messages asked for. */
interface MessageBoxScope {
  messageBoxesAsked?: string[];
}

/**
 * Runs in the main process: replace the message boxes of Electron's `dialog`
 * with a recorder that shows nothing and answers as if OK were pressed.
 *
 * A box the application raises while a case runs — the *Not kept* warning of
 * `sayUnkept` (`src/app/window.ts`), when a write into the profile fails — would
 * otherwise appear on the screen of whoever runs the suite and stay there until
 * they press OK; one did, during a test run on 2026-11-04. Recorded instead, it
 * is a failure of the case ({@link requireNoMessageBox}), since no case launched
 * here expects one; a case that does replaces `dialog.showMessageBox` itself, as
 * `theme.spec.ts` does. Installed once the application has started, so a box
 * raised before that is not caught: the application raises none before a choice
 * is written (`src/app/theme.ts`, `src/app/selections.ts`).
 */
function holdMessageBoxes(electronModule: { dialog: object }): void {
  const asked: string[] = [];
  Object.assign(globalThis as MessageBoxScope, { messageBoxesAsked: asked });
  const said = (options: unknown): string =>
    String((options as { message?: unknown } | undefined)?.message ?? options);
  const optionsOf = (args: unknown[]): unknown =>
    args.find((each) => typeof each === 'object' && each !== null && 'message' in each);
  Object.assign(electronModule.dialog, {
    showMessageBox: (...args: unknown[]) => {
      asked.push(said(optionsOf(args)));
      return Promise.resolve({ response: 0, checkboxChecked: false });
    },
    showMessageBoxSync: (...args: unknown[]) => {
      asked.push(said(optionsOf(args)));
      return 0;
    },
    showErrorBox: (title: string, content: string) => {
      asked.push(`${title}: ${content}`);
    },
  });
}

/** Runs in the main process: the messages {@link holdMessageBoxes} recorded. */
function readMessageBoxes(): string[] {
  return (globalThis as MessageBoxScope).messageBoxesAsked ?? [];
}

/** Fail if the application asked for any message box while the case ran. */
function requireNoMessageBox(asked: readonly string[]): void {
  if (asked.length > 0) {
    throw new Error(`the application asked for a message box: ${asked.join(' | ')}`);
  }
}
