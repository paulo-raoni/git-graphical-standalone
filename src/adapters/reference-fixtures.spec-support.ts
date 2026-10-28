import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateRepository,
  git,
  gitAt,
  linearCommits,
  readSpecification,
  takeStamp,
} from '../../test/fixtures/generate';
import type { FixtureSpecification, Workspace } from '../../test/fixtures/generate';

import { suiteFixtureAt } from './fixtures.spec-support';

/**
 * Three repositories of E03-M01-S11's, about the references a repository holds:
 * very many of them, the ones `git svn` writes, and a configuration that colours
 * git's output.
 *
 * **Why they are built here and not by the fixture generator.** The generator,
 * `test/fixtures/generate.ts`, measured 299 lines of code by the lint gate's own
 * count (`max-lines` with blank lines and comments skipped) at this slice's base,
 * against a limit of 300, so a shape added to it fails `gates:lint`. The rule
 * says such a module is two modules that have not been split, and this slice's
 * boundary holds no new module beside it to split it into. This module is inside
 * that boundary, so the three are built here, from the generator's own building
 * blocks — each starts from one of its shapes, written by `generateRepository`,
 * and goes on with its `git` and `gitAt` — and are published and verified as
 * the specification's repositories are, by `suiteFixtureAt` of
 * `./fixtures.spec-support`.
 *
 * What they do not get is the generator's two proofs: their object names are not
 * recorded in `expected-object-names.json`, and they are not built twice and
 * compared. Nothing here depends on an object name: every assertion made over
 * these repositories compares the reader with what git reports about the same
 * repository.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The files whose code builds these repositories. */
const SOURCES = [
  fileURLToPath(import.meta.url),
  join(here, '..', '..', 'test', 'fixtures', 'generate.ts'),
];

/** Local branches `many-refs` has beside `main`. */
export const MANY_LOCAL_BRANCHES = 1000;

/** Remote-tracking branches `many-refs` has, one on each local branch's commit. */
export const MANY_REMOTE_BRANCHES = 1000;

/** Tags `many-refs` has, every even-numbered one annotated. */
export const MANY_TAGS = 500;

/** Commits on the trunk of `many-refs`. */
export const MANY_REFS_COMMITS = 3000;

/** A number written with `width` digits, so that names sort as they count. */
function padded(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * A repository built from one of the generator's shapes, and a workspace whose
 * clock starts a day after the specification's, so that a commit made on top of
 * it is never stamped like one the shape made.
 */
function startFrom(
  directory: string,
  shape: string,
  commits: number,
  specification: FixtureSpecification,
): Workspace {
  generateRepository(directory, { name: shape, shape, commits }, specification);
  const seconds = specification.firstSecond + 86_400;
  return {
    directory,
    identity: specification.identity,
    clock: { seconds, step: specification.stepSeconds, zone: specification.zone },
  };
}

/**
 * Over a thousand branches and very many tags.
 *
 * The generator's `large` shape writes a trunk of {@link MANY_REFS_COMMITS}
 * commits on `main` through `fast-import`. Then {@link MANY_LOCAL_BRANCHES}
 * local branches `branch-0000` onwards, {@link MANY_REMOTE_BRANCHES}
 * remote-tracking branches `origin/branch-0000` onwards on the same commits, as
 * pushed branches stand, and {@link MANY_TAGS} tags `tag-000` onwards, the
 * even-numbered ones annotated.
 *
 * Branch `i` stands on the trunk's commit `7i mod 3000`, counted from its root:
 * seven does not divide 3 000 and there are fewer branches than commits, so no
 * two branches share a commit, and they are spread over the whole history, some
 * inside a first page and most past it. Tag `j` stands on commit `11j mod 3000`.
 *
 * Written packed, which is also how a clone leaves references, and for speed:
 * importing a `fast-export` of an earlier build of this repository, which
 * creates all 2 501 references as loose files, took 10.9 seconds on the
 * development machine, one run on 2026-10-27, where importing its trunk alone
 * took 0.6. So `fast-import` writes only the annotated tags, which are
 * objects; every other reference is written straight into `packed-refs`, one
 * `<object name> <reference>` line each, the file's plainest form; and
 * `git pack-refs --all` folds the loose ones in and rewrites the file as git
 * itself writes it.
 */
function manyRefs(directory: string, specification: FixtureSpecification): void {
  const workspace = startFrom(directory, 'large', MANY_REFS_COMMITS, specification);
  const trunk = git(workspace, ['rev-list', '--reverse', 'main']).split('\n');
  const commitAt = (index: number): string => trunk[index % MANY_REFS_COMMITS] ?? '';
  const { committerName, committerEmail } = workspace.identity;
  const stream: string[] = [];
  const lines: string[] = [];
  for (let tag = 0; tag < MANY_TAGS; tag += 1) {
    const name = `tag-${padded(tag, 3)}`;
    if (tag % 2 === 1) {
      lines.push(`${commitAt(11 * tag)} refs/tags/${name}`);
      continue;
    }
    const message = `release ${name}\n`;
    stream.push(
      `tag ${name}\nfrom ${commitAt(11 * tag)}\n`,
      `tagger ${committerName} <${committerEmail}> ${takeStamp(workspace.clock)}\n`,
      `data ${String(Buffer.byteLength(message))}\n${message}\n`,
    );
  }
  git(workspace, ['fast-import', '--done', '--quiet'], `${stream.join('')}done\n`);
  for (let branch = 0; branch < MANY_LOCAL_BRANCHES; branch += 1) {
    lines.push(`${commitAt(7 * branch)} refs/heads/branch-${padded(branch, 4)}`);
  }
  for (let branch = 0; branch < MANY_REMOTE_BRANCHES; branch += 1) {
    lines.push(`${commitAt(7 * branch)} refs/remotes/origin/branch-${padded(branch, 4)}`);
  }
  writeFileSync(join(directory, '.git', 'packed-refs'), `${lines.join('\n')}\n`);
  git(workspace, ['pack-refs', '--all']);
}

/**
 * The remote branches `git svn` leaves: references under `refs/remotes/` that
 * name no remote.
 *
 * By git-svn's documentation (no `git svn` is run here), `git svn` without a
 * prefix writes the svn trunk as `refs/remotes/trunk`, each svn branch as
 * `refs/remotes/<branch>` and each svn tag as `refs/remotes/tags/<tag>`; with
 * `--prefix=svn/` they sit under
 * `refs/remotes/svn/` instead, which looks like a remote named `svn` and is not
 * one. Beside them stands an ordinary `refs/remotes/origin/main`.
 *
 * Three commits on `main` (the generator's `linear` shape), then one commit that
 * only `refs/remotes/trunk` reaches, so that a page has to read that reference
 * itself to hold it. `refs/remotes/tags/v1` stands on `main~1`, and
 * `refs/remotes/svn/trunk` and `refs/remotes/origin/main` on `main`. As in the
 * generator's `remotes` shape, the references are written with `update-ref`,
 * which is all a page reads of what `git svn` or a fetch leaves behind.
 */
function svnRemotes(directory: string, specification: FixtureSpecification): void {
  const workspace = startFrom(directory, 'linear', 3, specification);
  git(workspace, ['switch', '--quiet', '--create', 'svn-trunk', 'main']);
  linearCommits(workspace, 1, 'trunk.txt');
  git(workspace, ['switch', '--quiet', 'main']);
  const moves = [
    'update refs/remotes/trunk svn-trunk',
    'update refs/remotes/tags/v1 main~1',
    'update refs/remotes/svn/trunk main',
    'update refs/remotes/origin/main main',
    'delete refs/heads/svn-trunk',
  ];
  git(workspace, ['update-ref', '--stdin'], `${moves.join('\n')}\n`);
}

/**
 * Colour configuration a person might well have, in the repository's own file.
 *
 * `color.ui` and `color.branch` are the two the reference behaviour names.
 * `color.diff` is the key `git log` and `git stash list` read for colour, ahead
 * of `color.ui`, and `color.status` the one `git status` reads; each is a
 * setting that an override of `color.ui` alone would leave in force.
 */
const COLOURED = ['color.ui', 'color.branch', 'color.diff', 'color.status'];

/**
 * A repository whose own configuration asks git to colour everything it can.
 *
 * Three commits on `main` over a modified file and an untracked one (the
 * generator's `dirty-working-tree` shape); a branch `side` and a lightweight
 * tag `light` one commit back; an annotated tag `annotated` on `main`; a
 * remote-tracking `origin/main` one commit back; and the modification stashed,
 * leaving the untracked file: one of each kind of name the reader shows, and
 * output from every command it runs. Then each of {@link COLOURED} is set to
 * `always`, which colours even output that goes to a pipe.
 */
function colourConfig(directory: string, specification: FixtureSpecification): void {
  const workspace = startFrom(directory, 'dirty-working-tree', 3, specification);
  git(workspace, ['branch', 'side', 'main~1']);
  git(workspace, ['tag', 'light', 'main~1']);
  gitAt(workspace, ['tag', '--annotate', '-m', 'a described release', 'annotated']);
  git(workspace, ['update-ref', 'refs/remotes/origin/main', 'main~1']);
  gitAt(workspace, ['stash', 'push', '--message', 'work in progress']);
  for (const key of COLOURED) {
    git(workspace, ['config', key, 'always']);
  }
}

const BUILDERS = new Map([
  ['many-refs', manyRefs],
  ['svn-remotes', svnRemotes],
  ['colour-config', colourConfig],
]);

/** The path of one of this module's repositories, built and published if there is none. */
export function referenceFixtureAt(name: 'many-refs' | 'svn-remotes' | 'colour-config'): string {
  const build = BUILDERS.get(name);
  if (build === undefined) {
    throw new Error(`no reference fixture named "${name}"`);
  }
  const specification = readSpecification();
  return suiteFixtureAt(name, SOURCES, (directory) => {
    build(directory, specification);
  });
}
