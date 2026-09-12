import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * So this builds a copy somewhere else, by running the committed generator with
 * the root it takes as an argument. The directory is named after a digest of
 * `specification.json`, so it is reused between runs and a change to the recipe
 * produces a different directory rather than a stale one.
 *
 * This module is `.spec-support.ts` rather than `.spec.ts` on purpose: the
 * fixture suite matches `*.spec.ts`, and a helper collected as a suite of its own
 * is a suite with no tests in it.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** The repository root, two directories above this file. */
const root = join(here, '..', '..');

const generator = join(root, 'test', 'fixtures', 'generate.ts');
const specification = join(root, 'test', 'fixtures', 'specification.json');

/** What the repositories were built from, so a changed recipe builds elsewhere. */
const recipe = createHash('sha256').update(readFileSync(specification)).digest('hex').slice(0, 12);

/** Where this suite's repositories live. */
export const fixtureRoot = join(tmpdir(), `git-graphical-standalone-fixtures-${recipe}`);

/** Written last, so its presence means the generation finished rather than started. */
const marker = join(fixtureRoot, 'generated.txt');

/** Held while one worker generates, so the others wait rather than race it. */
const lock = `${fixtureRoot}.lock`;

/** How long a waiting worker gives the generating one before giving up. */
const PATIENCE_MS = 240_000;

/** The path of one fixture repository, by the name the specification gives it. */
export function fixtureAt(name: string): string {
  return join(fixtureRoot, name);
}

/** Sleep without a timer, which is the only way to wait inside a synchronous hook. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Wait for the worker that took the lock to finish generating. */
function waitForGeneration(): void {
  const until = Date.now() + PATIENCE_MS;
  while (!existsSync(marker)) {
    if (Date.now() > until) {
      throw new Error(`the fixture repositories under ${fixtureRoot} were never generated`);
    }
    pause(100);
  }
}

/** Build this suite's fixture repositories, once, however many workers ask. */
export function ensureFixtures(): void {
  if (existsSync(marker)) {
    return;
  }
  try {
    mkdirSync(lock, { recursive: false });
  } catch {
    waitForGeneration();
    return;
  }
  try {
    execFileSync(process.execPath, [generator, fixtureRoot], { cwd: root, stdio: 'ignore' });
    writeFileSync(marker, `${recipe}\n`);
  } finally {
    rmSync(lock, { recursive: true, force: true });
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
