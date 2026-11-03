import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * What the checks of `test/gates/` share: the shape of a Stryker report as the
 * mutation gate reads it, the gate's own modules loaded as they are on disk, and
 * the committed fixtures beside this file.
 *
 * The gate's modules are JavaScript and belong to no TypeScript project, so each
 * is loaded by URL and given the type of the few names the checks call. The
 * types are the checks' reading of those names, not a declaration the modules
 * keep: a module that changes a name or its arguments turns its check red, which
 * is what a check of it is for.
 */

/** The repository root, two directories above this file. */
export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Position {
  readonly line: number;
  readonly column: number;
}

export interface Mutant {
  readonly id: string;
  readonly mutatorName: string;
  readonly replacement?: string;
  readonly status: string;
  readonly statusReason?: string;
  readonly testsCompleted?: number;
  readonly location: { readonly start: Position; readonly end: Position };
}

export interface ReportFile {
  readonly source: string;
  readonly mutants: readonly Mutant[];
}

export type Files = Readonly<Record<string, ReportFile>>;

/** One run of the per-mutant command as the re-measure clause collects it. */
export interface Run {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly output: string;
  readonly ms: number;
}

/** A gate module, loaded from `scripts/gates/` as the gate itself loads it. */
export async function gateModule<T>(name: string): Promise<T> {
  return (await import(pathToFileURL(join(root, 'scripts', 'gates', name)).href)) as T;
}

/** A committed fixture of this folder, parsed. */
export function fixture(name: string): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
}

/** Every mutant of the files, with the report key it sits under. */
export function mutantsOf(
  files: Files,
): readonly { readonly key: string; readonly mutant: Mutant }[] {
  return Object.entries(files).flatMap(([key, file]) =>
    file.mutants.map((mutant) => ({ key, mutant })),
  );
}
