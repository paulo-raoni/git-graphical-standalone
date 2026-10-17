import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRepository, readSpecification } from '../../test/fixtures/generate';
import { verifiedCopy } from '../../test/fixtures/shared-store';

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
 * So this builds a copy somewhere else, with the committed generator. The copy
 * lives under {@link home}, named after a digest of `specification.json`, so it
 * is reused between runs and a change to the recipe produces a different
 * directory rather than a stale one. One copy of each repository serves every run
 * of the fixture suite on the machine, published under {@link fixtureRoot} by the
 * rules of `test/fixtures/shared-store.ts`, which the end-to-end suites' store
 * shares: each repository is built into a staging directory of the building
 * process's own, given a record of what it is, and published with one rename;
 * no run builds into, removes or renames a directory another run can name.
 *
 * **What is verified, and when.** {@link ensureFixtures} and every call of
 * {@link fixtureAt} compare the repository with the record written when it was
 * published, before a path is returned, and never return one that differs: a
 * changed repository is left in place, unread, and the next copy is used or
 * built, so {@link fixtureAt} can name `<name>.2` rather than `<name>`. **What is
 * not verified** is a repository after its path has been returned: a file removed
 * while a case reads it is not seen by that case. This suite compares the
 * adapter with git on the same repository, so a case cannot see a changed
 * repository for itself; the check is the only thing that does.
 *
 * On Linux a rename onto a non-empty directory is refused with `ENOTEMPTY`, but
 * a rename onto an **empty** one replaces it (measured by E01-M01-FIX-26 with
 * `os.rename` in Python 3 on WSL Ubuntu, Linux 6.18, one trial each, as review
 * round 18 had measured before it). No published name is ever an empty
 * directory: only the rename creates one, and the directory renamed holds the
 * `.git` the generator wrote before it returned.
 *
 * {@link home} is neither the `git-graphical-standalone-unit-shared-` directory
 * the code before E01-M01-FIX-33 published a whole set into, with no record,
 * which a checkout of that code still reads as it finds it, nor the
 * `git-graphical-standalone-fixtures-` directory an older checkout builds into
 * in place under a lock, so those protocols' files and this one's never meet.
 *
 * This module is `.spec-support.ts` rather than `.spec.ts` on purpose: the
 * fixture suite matches `*.spec.ts`, and a helper collected as a suite of its own
 * is a suite with no tests in it.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The repository root, two directories above this file. */
const root = join(here, '..', '..');

const specification = join(root, 'test', 'fixtures', 'specification.json');

/** What the repositories were built from, so a changed recipe builds elsewhere. */
const recipe = createHash('sha256').update(readFileSync(specification)).digest('hex').slice(0, 12);

/** Everything this module keeps on the machine: the published repositories and the builds in progress. */
const home = join(tmpdir(), `git-graphical-standalone-unit-verified-${recipe}`);

/** Where this suite's repositories live, each published there once built. */
export const fixtureRoot = join(home, 'repositories');

/** Where each build happens, in a directory named `<process identifier>-` and six random characters. */
const stagingRoot = join(home, 'staging');

/**
 * The path of one fixture repository, by the name the specification gives it:
 * the first copy that matches its record, built and published if there is none.
 */
export function fixtureAt(name: string): string {
  const recipeOf = readSpecification(specification);
  const repository = recipeOf.repositories.find((one) => one.name === name);
  if (repository === undefined) {
    throw new Error(`the fixture specification names no repository "${name}"`);
  }
  mkdirSync(fixtureRoot, { recursive: true });
  return verifiedCopy(join(fixtureRoot, name), stagingRoot, (directory) => {
    generateRepository(directory, repository, recipeOf);
  });
}

/** Make sure every repository of the specification is published and matches its record. */
export function ensureFixtures(): void {
  for (const repository of readSpecification(specification).repositories) {
    fixtureAt(repository.name);
  }
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
