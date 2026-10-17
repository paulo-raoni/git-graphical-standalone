import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as UnitStore from '../../src/adapters/fixtures.spec-support';
import type * as EndToEndStore from '../e2e/support/fixtures';
import { generateRepository, readSpecification } from './generate';
import { differenceFrom, verifiedCopy } from './shared-store';

/**
 * The check both stores of shared fixture repositories make before they hand a
 * repository out, held to what it must see.
 *
 * Each store reads `os.tmpdir()` once, when its module loads, so both are loaded
 * here with `TEMP`, `TMP` and `TMPDIR` pointed at a directory of this run's own,
 * and the variables are put back before any case runs. Nothing here reaches the
 * machine's own stores, and the first case says so.
 *
 * Every kind of damage is made to a published repository of each store, and the
 * store is asked for it again. It must hand out another copy, one that matches
 * its record and looks to git exactly as the damaged one did before the damage,
 * leave the damaged one where it is, as damaged as it was, and say on standard
 * error which directory it passed over and why.
 */

let privateRoot = '';
let unit: typeof UnitStore;
let endToEnd: typeof EndToEndStore;
const written: string[] = [];

const VARIABLES = ['TEMP', 'TMP', 'TMPDIR'] as const;

beforeAll(async () => {
  privateRoot = mkdtempSync(join(tmpdir(), 'gg-stores-'));
  const saved = VARIABLES.map((name) => process.env[name]);
  for (const name of VARIABLES) {
    process.env[name] = privateRoot;
  }
  try {
    unit = await import('../../src/adapters/fixtures.spec-support');
    endToEnd = await import('../e2e/support/fixtures');
  } finally {
    VARIABLES.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    });
  }
});

afterAll(() => {
  // A case that fails before its own clean-up must not leave its repository behind.
  endToEnd.removeOwnFixtures();
  rmSync(privateRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

afterEach(() => {
  vi.restoreAllMocks();
  written.splice(0);
});

/** Catch what a store writes to standard error, and keep it off the run's output. */
function catchStandardError(): void {
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_COMMITTER_NAME: 'Damage',
      GIT_COMMITTER_EMAIL: 'damage@fixture.invalid',
    },
  });
}

/** What git says a repository is: references, working tree, stash and index. */
function looksLike(repository: string): string[] {
  return [
    git(repository, ['show-ref', '--head']),
    git(repository, ['status', '--porcelain', '--untracked-files=all']),
    git(repository, ['stash', 'list', '--format=%H']),
    git(repository, ['ls-files', '--stage']),
  ];
}

interface Damage {
  readonly what: string;
  readonly shape: string;
  readonly commits: number;
  readonly make: (repository: string) => void;
  readonly said: RegExp;
}

const DAMAGES: readonly Damage[] = [
  {
    what: 'a tracked working-tree file removed',
    shape: 'linear',
    commits: 2,
    make: (at) => {
      unlinkSync(join(at, 'file.txt'));
    },
    said: /^file\.txt has gone$/,
  },
  {
    what: 'a tracked file whose content changed',
    shape: 'linear',
    commits: 2,
    make: (at) => {
      writeFileSync(join(at, 'file.txt'), 'changed\n');
    },
    said: /^file\.txt has changed$/,
  },
  {
    what: 'an untracked file removed',
    shape: 'dirty-working-tree',
    commits: 2,
    make: (at) => {
      unlinkSync(join(at, 'untracked.txt'));
    },
    said: /^untracked\.txt has gone$/,
  },
  {
    what: 'an untracked file added',
    shape: 'linear',
    commits: 2,
    make: (at) => {
      writeFileSync(join(at, 'added.txt'), 'added\n');
    },
    said: /^added\.txt was not there when it was published$/,
  },
  {
    what: 'a branch moved',
    shape: 'branch-and-merge',
    commits: 2,
    make: (at) => git(at, ['update-ref', 'refs/heads/feature', 'main~1']),
    said: /refs\/heads\/feature has changed$/,
  },
  {
    what: 'a branch removed',
    shape: 'branch-and-merge',
    commits: 2,
    make: (at) => git(at, ['branch', '-D', 'feature']),
    said: /refs\/heads\/feature has gone$/,
  },
  {
    what: 'a tag moved',
    shape: 'tags',
    commits: 3,
    make: (at) => git(at, ['update-ref', 'refs/tags/lightweight', 'HEAD']),
    said: /^\.git\/refs\/tags\/lightweight has changed$/,
  },
  {
    what: 'a tag removed',
    shape: 'tags',
    commits: 3,
    make: (at) => git(at, ['tag', '--delete', 'annotated']),
    said: /^\.git\/refs\/tags\/annotated has gone$/,
  },
  {
    what: 'the stash gone',
    shape: 'stash',
    commits: 2,
    make: (at) => git(at, ['stash', 'drop', '--quiet']),
    said: /refs\/stash has gone$/,
  },
  {
    what: 'HEAD moved',
    shape: 'detached-head',
    commits: 3,
    make: (at) => git(at, ['update-ref', '--no-deref', 'HEAD', 'HEAD~1']),
    said: /^\.git\/HEAD has changed$/,
  },
  {
    what: 'an object file removed',
    shape: 'linear',
    commits: 2,
    make: (at) => {
      const blob = git(at, ['rev-parse', 'HEAD:file.txt']).trim();
      unlinkSync(join(at, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    },
    said: /^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38} has gone$/,
  },
  {
    what: 'a pack rewritten',
    // Enough commits that `fast-import` keeps its pack rather than unpack it to
    // loose objects, which it does below a hundred objects.
    shape: 'large',
    commits: 50,
    make: (at) => {
      const packs = join(at, '.git', 'objects', 'pack');
      const pack = join(packs, readdirSync(packs).find((name) => name.endsWith('.pack')) ?? '');
      chmodSync(pack, 0o644);
      writeFileSync(pack, 'not a pack any more');
    },
    said: /^\.git\/objects\/pack\/pack-[0-9a-f]+\.pack has changed$/,
  },
  {
    what: 'the record removed',
    shape: 'linear',
    commits: 2,
    make: (at) => {
      unlinkSync(join(at, '.git', 'published-state.json'));
    },
    said: /^it has no readable record/,
  },
];

/** Damage what `ask` hands out, ask again, and hold the store to what it must do. */
function holdsTo(damage: Damage, ask: () => string): void {
  catchStandardError();
  const before = ask();
  const looked = looksLike(before);
  damage.make(before);
  written.splice(0);
  const after = ask();
  expect(after).not.toBe(before);
  expect(differenceFrom(after)).toBeUndefined();
  expect(looksLike(after)).toEqual(looked);
  expect(existsSync(before)).toBe(true);
  expect(differenceFrom(before)).toMatch(damage.said);
  const said = written.join('');
  expect(said).toContain(before);
  expect(said).toContain(String(differenceFrom(before)));
}

/** Ask twice, with git reading the repository between, and hold the store to one build. */
function readsAsItIs(ask: () => string): void {
  catchStandardError();
  const first = ask();
  const record = join(first, '.git', 'published-state.json');
  const recorded = statSync(record).mtimeMs;
  looksLike(first);
  expect(ask()).toBe(first);
  expect(existsSync(`${first}.2`)).toBe(false);
  expect(statSync(record).mtimeMs).toBe(recorded);
  expect(written).toEqual([]);
}

describe('both stores, loaded for this run', () => {
  it('keep their repositories under this run’s own directory', () => {
    expect(unit.fixtureRoot.startsWith(privateRoot)).toBe(true);
    expect(endToEnd.fixtureRoot.startsWith(privateRoot)).toBe(true);
  });
});

describe('the end-to-end store, asked for a repository that has changed', () => {
  DAMAGES.forEach((damage, index) => {
    it(`does not hand out a repository with ${damage.what}`, () => {
      holdsTo(damage, () =>
        endToEnd.fixture(`damage-${String(index)}`, damage.shape, damage.commits),
      );
    });
  });

  it('hands an unchanged repository out as it is, without building it again', () => {
    readsAsItIs(() => endToEnd.fixture('unchanged', 'stash', 2));
  });

  it('hands out what the generator writes, under a name of its own for each recipe', () => {
    const shared = endToEnd.fixture('recipe', 'tags', 3);
    const own = endToEnd.ownFixture('recipe', 'tags', 3);
    expect(looksLike(shared)).toEqual(looksLike(own));
    expect(endToEnd.fixture('recipe', 'linear', 3)).not.toBe(shared);
    endToEnd.removeOwnFixtures();
  });
});

describe('the adapter suite’s store, asked for a repository that has changed', () => {
  it('publishes every repository of the specification, each with its record', () => {
    unit.ensureFixtures();
    for (const repository of readSpecification().repositories) {
      expect(differenceFrom(join(unit.fixtureRoot, repository.name))).toBeUndefined();
    }
  });

  for (const damage of DAMAGES) {
    it(`does not hand out a repository with ${damage.what}`, () => {
      holdsTo(damage, () => unit.fixtureAt(damage.shape));
    });
  }

  it('hands an unchanged repository out as it is, without building it again', () => {
    readsAsItIs(() => unit.fixtureAt('two-roots'));
  });
});

describe('a copy that differs from its record the moment it is published', () => {
  it('fails the run at once rather than build another', () => {
    const published = join(privateRoot, 'raced', 'linear');
    const specification = readSpecification();
    const build = (directory: string): void => {
      generateRepository(directory, { name: 'linear', shape: 'linear', commits: 2 }, specification);
      mkdirSync(join(published, '.git'), { recursive: true });
    };
    expect(() => verifiedCopy(published, join(privateRoot, 'raced', 'staging'), build)).toThrow(
      `fixture ${published} differs from its record as soon as published: it has no readable record`,
    );
    expect(existsSync(`${published}.2`)).toBe(false);
  });
});
