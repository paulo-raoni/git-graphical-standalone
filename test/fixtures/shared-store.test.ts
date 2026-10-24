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
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * error which directory it passed over and why. The damaged one stays because
 * this process was handed it and still runs; what happens once no such process
 * runs is the last case's. Every damage case asks for a repository no other case
 * names — the end-to-end store's by name, the adapter suite's by a set of its own
 * — so that no case is handed what an earlier one damaged, and the cases pass in
 * any order (E03-M01-S05 ran them shuffled; its slice document says how).
 */

let privateRoot = '';
let unit: typeof UnitStore;
let endToEnd: typeof EndToEndStore;
const written: string[] = [];

const VARIABLES = ['TEMP', 'TMP', 'TMPDIR'] as const;

/** Directories named as the stores before E01-M01-FIX-33 were, and two that only look like them. */
const OLD_STORES = ['e2e', 'unit'].map(
  (kind) => `git-graphical-standalone-${kind}-shared-0123456789ab`,
);
const LOOK_ALIKES = ['e2e-shared-0123456789ab-kept', 'e2e-verified-0123456789ab'].map(
  (name) => `git-graphical-standalone-${name}`,
);

beforeAll(async () => {
  privateRoot = mkdtempSync(join(tmpdir(), 'gg-stores-'));
  for (const name of [...OLD_STORES, ...LOOK_ALIKES]) {
    mkdirSync(join(privateRoot, name, 'repositories', 'linear'), { recursive: true });
  }
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
  readonly make: (repository: string) => unknown;
  readonly said: RegExp;
}

/** The commits each shape is built with by the end-to-end store, where it is not two. */
const COMMITS: Readonly<Record<string, number>> = { tags: 3, 'detached-head': 3, large: 50 };

/** A damage named `what`, made to a repository of `shape`, that the check must report as `said`. */
function damage(
  what: string,
  shape: string,
  said: RegExp,
): { by: (make: Damage['make']) => Damage } {
  return { by: (make) => ({ what, shape, commits: COMMITS[shape] ?? 2, make, said }) };
}

const DAMAGES: readonly Damage[] = [
  damage('a tracked working-tree file removed', 'linear', /^file\.txt has gone$/).by((at) => {
    unlinkSync(join(at, 'file.txt'));
  }),
  damage('a tracked file whose content changed', 'linear', /^file\.txt has changed$/).by((at) => {
    writeFileSync(join(at, 'file.txt'), 'changed\n');
  }),
  // The working tree keeps the file, now untracked, so only the index's digest moves.
  damage(
    'a file removed from the index alone',
    'linear',
    /^the index, as git ls-files --stage lists it has changed$/,
  ).by((at) => git(at, ['rm', '--cached', '--quiet', 'file.txt'])),
  damage('an untracked file removed', 'dirty-working-tree', /^untracked\.txt has gone$/).by(
    (at) => {
      unlinkSync(join(at, 'untracked.txt'));
    },
  ),
  damage(
    'an untracked file added',
    'linear',
    /^added\.txt was not there when it was published$/,
  ).by((at) => {
    writeFileSync(join(at, 'added.txt'), 'added\n');
  }),
  damage('a branch moved', 'branch-and-merge', /refs\/heads\/feature has changed$/).by((at) =>
    git(at, ['update-ref', 'refs/heads/feature', 'main~1']),
  ),
  damage('a branch removed', 'branch-and-merge', /refs\/heads\/feature has gone$/).by((at) =>
    git(at, ['branch', '-D', 'feature']),
  ),
  damage('a tag moved', 'tags', /^\.git\/refs\/tags\/lightweight has changed$/).by((at) =>
    git(at, ['update-ref', 'refs/tags/lightweight', 'HEAD']),
  ),
  damage('a tag removed', 'tags', /^\.git\/refs\/tags\/annotated has gone$/).by((at) =>
    git(at, ['tag', '--delete', 'annotated']),
  ),
  damage('the stash gone', 'stash', /refs\/stash has gone$/).by((at) =>
    git(at, ['stash', 'drop', '--quiet']),
  ),
  damage('HEAD moved', 'detached-head', /^\.git\/HEAD has changed$/).by((at) =>
    git(at, ['update-ref', '--no-deref', 'HEAD', 'HEAD~1']),
  ),
  damage(
    'an object file removed',
    'linear',
    /^\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38} has gone$/,
  ).by((at) => {
    const blob = git(at, ['rev-parse', 'HEAD:file.txt']).trim();
    unlinkSync(join(at, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  }),
  // Enough commits that `fast-import` keeps its pack rather than unpack it to
  // loose objects, which it does below a hundred objects.
  damage(
    'a pack rewritten',
    'large',
    /^\.git\/objects\/pack\/pack-[0-9a-f]+\.pack has changed$/,
  ).by((at) => {
    const packs = join(at, '.git', 'objects', 'pack');
    const pack = join(packs, readdirSync(packs).find((name) => name.endsWith('.pack')) ?? '');
    chmodSync(pack, 0o644);
    writeFileSync(pack, 'not a pack any more');
  }),
  damage('the record removed', 'linear', /^it has no readable record/).by((at) => {
    unlinkSync(join(at, '.git', 'published-state.json'));
  }),
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

  DAMAGES.forEach((damage, index) => {
    it(`does not hand out a repository with ${damage.what}`, () => {
      // A set of its own: what an earlier case damaged is never what this one is handed.
      holdsTo(damage, () => unit.fixtureAt(damage.shape, `damage-${String(index)}`));
    });
  });

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

const here = dirname(fileURLToPath(import.meta.url));

/** A process of its own: asks the store for `published`, prints the path it is handed, and exits. */
const READER = [
  'const [store, generator, published, staging] = process.argv.slice(1);',
  'const { verifiedCopy } = await import(store);',
  'const { generateRepository, readSpecification } = await import(generator);',
  "const linear = { name: 'linear', shape: 'linear', commits: 2 };",
  'const build = (at) => generateRepository(at, linear, readSpecification());',
  'process.stdout.write(verifiedCopy(published, staging, build));',
].join('\n');

describe('what the stores leave behind', () => {
  it('removes the stores before E01-M01-FIX-33 when they load, and nothing else', () => {
    const left = (names: readonly string[]): string[] =>
      names.filter((name) => existsSync(join(privateRoot, name, 'repositories', 'linear')));
    expect(left(OLD_STORES)).toEqual([]);
    expect(left(LOOK_ALIKES)).toEqual(LOOK_ALIKES);
  });

  // The other half, a changed copy kept while a process it was handed to runs, is
  // `holdsTo`'s: this process was handed what it damages, and finds it still there.
  it('removes a changed copy once every process it was handed to has exited', () => {
    const published = join(privateRoot, 'handed', 'linear');
    const staging = join(privateRoot, 'handed', 'staging');
    const modules = ['shared-store.ts', 'generate.ts'].map((name) =>
      pathToFileURL(join(here, name)),
    );
    const reader = [
      '--input-type=module',
      '-e',
      READER,
      ...modules.map(String),
      published,
      staging,
    ];
    expect(execFileSync(process.execPath, reader, { encoding: 'utf8' })).toBe(published);
    unlinkSync(join(published, 'file.txt'));
    catchStandardError();
    const ask = (): string =>
      verifiedCopy(published, staging, (directory) => {
        generateRepository(
          directory,
          { name: 'linear', shape: 'linear', commits: 2 },
          readSpecification(),
        );
      });
    expect(ask()).toBe(`${published}.2`);
    expect([existsSync(published), existsSync(`${published}.handed`)]).toEqual([false, false]);
    expect(written.join('')).toContain(
      `fixture ${published} is not what was published: file.txt has gone. No process it was handed to runs, so it is removed.`,
    );
    // No number is used twice: copy 1 is not built again while copy 2 matches its record.
    expect(ask()).toBe(`${published}.2`);
    expect(existsSync(published)).toBe(false);
  });
});
