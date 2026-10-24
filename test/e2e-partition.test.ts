import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The end-to-end partition, held.
 *
 * `playwright.config.js` splits the cases of `test/e2e/` into two projects by
 * the `@budgets` tag: `application`, which `npm run gates:e2e` runs inside every
 * tier, and `budgets`, which `npm run gates:budgets` runs on a free machine
 * (`AGENTS.md` §11, *Gate tiers*). A case in both is run on a loaded machine
 * and read as a verdict there; a case in neither is run by no gate at all, and
 * nothing would say so. This file asks Playwright itself which cases each
 * project collects and holds the two lists to every case the folder holds.
 *
 * **Every case** cannot be read from `playwright test --list` with no project
 * named, although that is what E01-M01-S11 compared with: with no project named
 * Playwright lists each project's own cases, so a case no project collects is
 * missing from that list too, and the comparison passes. E03-M01-S05 saw it
 * pass so with the `budgets` project's pattern renamed and six cases in neither
 * project. So every case is listed a second time, through a configuration that
 * is the committed one with its two projects replaced by one that filters
 * nothing, written for the run to a temporary directory of its own.
 *
 * It lives in `test/` and is a `*.test.ts`, so `vitest.fixtures.config.js`
 * collects it and `npm run gates:unit` runs it, in the quick and the full tier
 * and in the workflow's unit job. It reads no clock and launches no
 * application: listing loads the spec files and runs none of them.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

/** The two projects of `playwright.config.js`, by name. */
const PROJECTS = ['application', 'budgets'] as const;

/** One case as Playwright lists it: its file under `test/e2e/`, then its titles. */
type Case = string;

interface ListedSuite {
  readonly title: string;
  readonly specs?: readonly {
    readonly title: string;
    readonly file: string;
    readonly tests: readonly { readonly projectName: string }[];
  }[];
  readonly suites?: readonly ListedSuite[];
}

interface Listing {
  readonly suites: readonly ListedSuite[];
  readonly errors: readonly unknown[];
}

/** The cases each project of a listing collects, by project name. */
type ByProject = ReadonlyMap<string, ReadonlySet<Case>>;

function collect(suite: ListedSuite, path: readonly string[], into: Map<string, Set<Case>>): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      const cases = into.get(test.projectName) ?? new Set<Case>();
      cases.add([spec.file, ...path, spec.title].join(' > '));
      into.set(test.projectName, cases);
    }
  }
  for (const child of suite.suites ?? []) {
    collect(child, [...path, child.title], into);
  }
}

/** What `playwright test --list` says each project collects, run with `args`. */
function listed(args: readonly string[]): ByProject {
  const output = execFileSync(
    process.execPath,
    [cli, 'test', '--list', '--reporter=json', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const listing = JSON.parse(output) as Listing;
  expect(listing.errors).toEqual([]);
  const byProject = new Map<string, Set<Case>>();
  // A file's own suite is titled with the file's name, which each case carries already.
  for (const file of listing.suites) {
    collect(file, [], byProject);
  }
  return byProject;
}

/** Every case of `test/e2e/`, listed through the committed configuration with no project filtering. */
function everyCase(): ReadonlySet<Case> {
  const scratch = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-partition-'));
  try {
    const config = join(scratch, 'every-case.config.mjs');
    const committed = pathToFileURL(join(root, 'playwright.config.js')).href;
    writeFileSync(
      config,
      `import config from ${JSON.stringify(committed)};\n` +
        `export default { ...config, testDir: ${JSON.stringify(join(root, 'test', 'e2e'))}, ` +
        `projects: [{ name: 'every case' }] };\n`,
    );
    return listed(['--config', config]).get('every case') ?? new Set<Case>();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Every way `byProject` fails to split `every` in two, in words: a case in both
 * projects, a case in neither, a case a project lists that is not a case of the
 * folder, a project that is not one of the two. Empty when the split is sound.
 */
function partitionComplaints(byProject: ByProject, every: ReadonlySet<Case>): string[] {
  const strangers = [...byProject.keys()].filter(
    (name) => !(PROJECTS as readonly string[]).includes(name),
  );
  const projectsOf = (each: Case): string[] =>
    PROJECTS.filter((name) => byProject.get(name)?.has(each) === true);
  const unknown = [...byProject].flatMap(([name, cases]) =>
    [...cases]
      .filter((each) => !every.has(each))
      .map((each) => `${each}: listed by ${name} and not among the cases of test/e2e/`),
  );
  return [
    ...strangers.map((name) => `a project named ${name} lists cases`),
    ...(every.size === 0 ? ['no case is listed at all'] : []),
    // The line the partition hinges on: each case of the folder in one project, no more, no fewer.
    ...[...every].flatMap((each) => {
      const count = projectsOf(each).length;
      if (count === 1) return [];
      return [
        `${each}: ${count === 0 ? 'in neither project, so no gate runs it' : 'in both projects'}`,
      ];
    }),
    ...unknown,
  ];
}

describe('the end-to-end partition', () => {
  it('puts every case of test/e2e/ in exactly one of the application and budgets projects', () => {
    const byProject = listed([]);
    const every = everyCase();
    const counts = PROJECTS.map((name) => `${name} ${String(byProject.get(name)?.size ?? 0)}`);
    process.stdout.write(`  ${String(every.size)} cases: ${counts.join(', ')}\n`);
    expect(partitionComplaints(byProject, every)).toEqual([]);
  });
});

describe('the comparison the partition is held by', () => {
  const every = new Set(['a.spec.ts > one', 'a.spec.ts > two @budgets', 'b.spec.ts > three']);
  const sound = new Map([
    ['application', new Set(['a.spec.ts > one', 'b.spec.ts > three'])],
    ['budgets', new Set(['a.spec.ts > two @budgets'])],
  ]);

  it('finds nothing to say about a sound split', () => {
    expect(partitionComplaints(sound, every)).toEqual([]);
  });

  it('names a case in both projects, and one in neither', () => {
    const both = new Map([
      ...sound,
      ['budgets', new Set(['a.spec.ts > two @budgets', 'b.spec.ts > three'])],
    ]);
    expect(partitionComplaints(both, every)).toEqual(['b.spec.ts > three: in both projects']);
    const neither = new Map([...sound, ['budgets', new Set<string>()]]);
    expect(partitionComplaints(neither, every)).toEqual([
      'a.spec.ts > two @budgets: in neither project, so no gate runs it',
    ]);
  });

  it('names a case no folder holds, a third project and an empty folder', () => {
    const stray = new Map([...sound, ['extra', new Set(['c.spec.ts > four'])]]);
    expect(partitionComplaints(stray, every)).toEqual([
      'a project named extra lists cases',
      'c.spec.ts > four: listed by extra and not among the cases of test/e2e/',
    ]);
    expect(partitionComplaints(new Map(), new Set())).toEqual(['no case is listed at all']);
  });
});
