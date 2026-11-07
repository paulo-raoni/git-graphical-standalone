import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateRepository, readSpecification } from './generate';
import { verifiedCopy } from './shared-store';

/**
 * The copies of one published repository, held to how `verifiedCopy` numbers,
 * publishes and removes them. Split out of `shared-store.test.ts` by
 * E04-M01-S07, with no case changed, so that the numbering case had room under
 * `max-lines`; that file holds the stores themselves to the check they make.
 *
 * Every case here calls `verifiedCopy` directly, over a directory of this run's
 * own under `os.tmpdir()`, and loads neither store, so nothing here reaches the
 * machine's own stores. A copy is damaged by removing its tracked file, which
 * `shared-store.test.ts` holds the check to seeing.
 */

let privateRoot = '';
const written: string[] = [];

beforeAll(() => {
  privateRoot = mkdtempSync(join(tmpdir(), 'gg-copies-'));
});

afterAll(() => {
  rmSync(privateRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

afterEach(() => {
  vi.restoreAllMocks();
  written.splice(0);
});

/** Catch what the store writes to standard error, and keep it off the run's output. */
function catchStandardError(): void {
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
}

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

/** Ask for `published` from a process of its own, which is handed a copy and exits. */
function askFromAnotherProcess(published: string, staging: string): string {
  const modules = ['shared-store.ts', 'generate.ts'].map((name) => pathToFileURL(join(here, name)));
  const reader = ['--input-type=module', '-e', READER, ...modules.map(String), published, staging];
  return execFileSync(process.execPath, reader, { encoding: 'utf8' });
}

/** Ask for `published` from this process. */
function askHere(published: string, staging: string): string {
  return verifiedCopy(published, staging, (directory) => {
    generateRepository(
      directory,
      { name: 'linear', shape: 'linear', commits: 2 },
      readSpecification(),
    );
  });
}

describe('what the stores leave behind', () => {
  // The other half, a changed copy kept while a process it was handed to runs, is
  // `holdsTo`'s in `shared-store.test.ts`: that process was handed what it
  // damages, and finds it still there.
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
    // Copy 1 is not built again while copy 2 exists: a copy is built one past the
    // highest that exists when the copies are listed.
    expect(ask()).toBe(`${published}.2`);
    expect(existsSync(published)).toBe(false);
  });
});

/**
 * **The line this case hinges on is `(copies.at(-1) ?? 0) + 1`** in
 * `verifiedCopy`. Review round 02 of E03-M01 changed it and every case stayed
 * green, because every case reached a new copy with copies 1 to n all present,
 * where the count of copies plus one is also one past the highest. Here the store
 * itself leaves a gap: copy 2 is handed to a process that exits, changes, and is
 * removed by the next ask, which builds copy 3. With copies 1 and 3 both changed
 * and kept, the next copy is 4. Counted rather than numbered, it would be 3,
 * which exists and differs from its record, and the ask would fail.
 */
describe('the number of the copy a store builds', () => {
  it('is one past the highest copy that exists, so a gap below it is not built into', () => {
    const published = join(privateRoot, 'numbered', 'linear');
    const staging = join(privateRoot, 'numbered', 'staging');
    catchStandardError();
    expect(askHere(published, staging)).toBe(published);
    unlinkSync(join(published, 'file.txt'));
    expect(askFromAnotherProcess(published, staging)).toBe(`${published}.2`);
    unlinkSync(join(`${published}.2`, 'file.txt'));
    expect(askHere(published, staging)).toBe(`${published}.3`);
    expect([existsSync(published), existsSync(`${published}.2`)]).toEqual([true, false]);
    unlinkSync(join(`${published}.3`, 'file.txt'));
    expect(askHere(published, staging)).toBe(`${published}.4`);
    expect(existsSync(`${published}.2`)).toBe(false);
  });
});
