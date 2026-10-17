import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateRepository, readSpecification } from '../../fixtures/generate';
import { removeDirectory, verifiedCopy } from '../../fixtures/shared-store';

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
 * before E01-M01-FIX-33 published into, whose repositories carry no record and
 * which a checkout of that code still reads as it finds it; nor the
 * `git-graphical-standalone-e2e-` one E01-M01-FIX-18 used. Different names keep
 * each protocol's files in different directories.
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
