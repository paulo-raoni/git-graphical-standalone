import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defaultFixtureRoot,
  expectationPath,
  fingerprintFixtures,
  fingerprintOf,
  generateFixtures,
  generateRepository,
  readSpecification,
} from './generate';
import type { RepositoryFingerprint } from './generate';

/**
 * Two kinds of proof, because they fail in different ways.
 *
 * **Against the committed object names**, which is the one that catches a
 * machine: the expectation file was recorded on the development machine, so a
 * generator that quietly picks up a local `user.name`, a timezone or a line
 * ending rule produces different object names here and the comparison fails.
 * Two runs on the same machine in the same minute would agree about all of that
 * and prove nothing.
 *
 * **Two runs compared with each other**, which catches the generator itself: a
 * clock read from the wall, a counter that keeps going between runs, a set
 * iterated in insertion order that is not the same order twice.
 */

const specification = readSpecification();

describe('the fixture repositories', () => {
  let generated: Record<string, RepositoryFingerprint>;

  beforeAll(() => {
    generateFixtures(defaultFixtureRoot(), specification);
    generated = fingerprintFixtures(defaultFixtureRoot(), specification);
  });

  it('carry the object names that were recorded from them', () => {
    const expected: unknown = JSON.parse(readFileSync(expectationPath(), 'utf8'));
    expect(generated).toEqual(expected);
  });

  it('include every shape wave three needs', () => {
    expect(Object.keys(generated).sort()).toEqual([
      'branch-and-merge',
      'detached-head',
      'dirty-working-tree',
      'large',
      'linear',
      'stash',
      'tags',
      'two-roots',
    ]);
  });

  it('include one history large enough for the performance work of S07', () => {
    const large = specification.repositories.find((repository) => repository.name === 'large');
    expect(large?.commits).toBeGreaterThanOrEqual(10000);
    expect(generated['large']?.commitCount).toBeGreaterThanOrEqual(10000);
  });
});

describe('generating the same repository twice', () => {
  let scratch: string;

  // A directory no other run can name. A fixed name under the temporary
  // directory is shared by every run on the machine, and runs that meet here
  // write into and remove each other's repositories: E01-M01-FIX-25 started two
  // runs of this describe together three times at its base, under a private
  // temporary directory, and five of the six runs failed.
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'git-graphical-fixture-determinism-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  // Two shapes rather than all eight: between them they cover an ordinary
  // commit, a branch, a merge and the commits git writes for a stash, and every
  // shape is compared against its recorded object names by the suite above.
  // Building all eight twice would add half a minute to every gate run to
  // re-prove the same property.
  const shapes = ['branch-and-merge', 'stash'];

  it('produces the same object names both times', () => {
    for (const repository of specification.repositories.filter((one) =>
      shapes.includes(one.name),
    )) {
      const first = join(scratch, 'first', repository.name);
      const second = join(scratch, 'second', repository.name);
      generateRepository(first, repository, specification);
      generateRepository(second, repository, specification);
      expect(fingerprintOf(second, specification)).toEqual(fingerprintOf(first, specification));
    }
  });
});
