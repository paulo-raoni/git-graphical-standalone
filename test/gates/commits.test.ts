import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gateModule, root } from './report';

/**
 * The commits gate's range, held: `defaultRange` of `scripts/gates/commits.js`,
 * the range the gate reads when no range is given, which is what continuous
 * integration and `npm run gates` read.
 *
 * The range runs from the previous promotion's tag to `HEAD`, and a promotion tag
 * on `HEAD` itself is skipped, so that the commit a promotion tags is read from
 * the promotion before it, release merge included (the gate's header argues it).
 * Review round 02 of E03-M01 removed `--no-contains=HEAD`, which is what skips
 * it, and every gate stayed green: this repository's own `HEAD` carries no
 * promotion tag on any lane, so nothing that reads this repository can see it.
 *
 * So the range is read in a repository built here, in a temporary directory of
 * this run's own, never in this one: promotions merged with `--no-ff` from a
 * `dev` into a `main` and tagged as `AGENTS.md` §8 tags them, and `HEAD` placed
 * where each case needs it. Every case names the commits its range must hold by
 * their subjects, which no commit of this repository carries, and one reads a
 * repository with no promotion tag at all, which this one is not.
 *
 * **The line this hinges on is `--no-contains=HEAD`** in `promotionTagsBehindHead`:
 * without it the first case reads `v0.2.0..HEAD`, which is empty.
 */

interface Range {
  readonly selected?: string;
  readonly why?: string;
  readonly refusal?: string;
}

interface Commits {
  readonly defaultRange: (repository: string) => Range;
}

const { defaultRange } = await gateModule<Commits>('commits.js');

let repository = '';

/** Git in the built repository, with an identity and no signing of its own. */
function git(...args: readonly string[]): string {
  return execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-C', repository, ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Range',
        GIT_AUTHOR_EMAIL: 'range@fixture.invalid',
        GIT_COMMITTER_NAME: 'Range',
        GIT_COMMITTER_EMAIL: 'range@fixture.invalid',
      },
    },
  );
}

function commit(subject: string): void {
  git('commit', '--quiet', '--allow-empty', '-m', subject);
}

/** A promotion as `AGENTS.md` §8 makes one: `dev` merged into `main`, the merge tagged, `dev` caught up. */
function promote(subject: string, tag: string): void {
  git('switch', '--quiet', 'main');
  git('merge', '--quiet', '--no-ff', 'dev', '-m', subject);
  git('tag', '-a', tag, '-m', subject);
  git('switch', '--quiet', 'dev');
  git('merge', '--quiet', '--ff-only', 'main');
}

/** The subjects of the range `defaultRange` chose with `HEAD` at `at`, newest first. */
function readAt(at: string): { readonly range: Range; readonly subjects: readonly string[] } {
  git('switch', '--quiet', '--detach', at);
  const range = defaultRange(repository);
  const subjects =
    range.selected === undefined
      ? []
      : git('log', '--format=%s', range.selected).split('\n').filter(Boolean);
  return { range, subjects };
}

beforeAll(() => {
  repository = mkdtempSync(join(tmpdir(), 'gg-commits-range-'));
  git('init', '--quiet', '--initial-branch=main');
  commit('chore: scaffold');
  git('tag', '-a', 'v0.0.0', '-m', 'scaffold');
  git('switch', '--quiet', '--create', 'dev');
  commit('feat(e01-m01-s01): first slice');
  promote('chore(release): e01-m01 first', 'v0.1.0');
  commit('feat(e02-m01-s01): second slice');
  promote('chore(release): e02-m01 second', 'v0.2.0');
  commit('feat(e03-m01-s01): third slice');
  git('tag', 'v0.9.0');
  commit('feat(e03-m01-s02): fourth slice');
  git('switch', '--quiet', '--create', 'side', 'v0.0.0');
  commit('feat(side): beside the first promotion');
  git('tag', '-a', 'v0.1.1', '-m', 'beside');
  git('switch', '--quiet', '--create', 'joined', 'v0.1.0');
  git('merge', '--quiet', '--no-ff', 'side', '-m', 'chore: join the two');
  git('switch', '--quiet', '--orphan', 'untagged');
  commit('chore: nothing promoted');
});

afterAll(() => {
  rmSync(repository, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

describe('the range the commits gate reads when none is given', () => {
  it('is read in a repository of its own, not in this one', () => {
    expect(relative(root, repository).startsWith('..')).toBe(true);
  });

  it('reads a release merge from the promotion before it, skipping the tag on HEAD', () => {
    const { range, subjects } = readAt('v0.2.0');
    expect(range).toEqual({
      selected: 'v0.1.0..HEAD',
      why: 'v0.1.0 is the latest promotion tag behind HEAD',
    });
    expect(subjects).toEqual(['chore(release): e02-m01 second', 'feat(e02-m01-s01): second slice']);
  });

  it('reads from the latest annotated promotion tag behind HEAD, and never a lightweight one', () => {
    const { range, subjects } = readAt('dev');
    expect(range.selected).toBe('v0.2.0..HEAD');
    expect(subjects).toEqual(['feat(e03-m01-s02): fourth slice', 'feat(e03-m01-s01): third slice']);
  });

  it('reads everything reachable when no promotion tag is behind HEAD', () => {
    const { range, subjects } = readAt('untagged');
    expect(range).toEqual({ selected: 'HEAD', why: 'no promotion tag is on an ancestor of HEAD' });
    expect(subjects).toEqual(['chore: nothing promoted']);
  });

  it('refuses when no promotion tag behind HEAD is the latest by ancestry', () => {
    const { range } = readAt('joined');
    expect(range.refusal).toBe(
      'no promotion tag is the latest by ancestry: v0.1.0, v0.1.1; pass a range as an argument or in GATE_COMMIT_RANGE',
    );
  });
});
