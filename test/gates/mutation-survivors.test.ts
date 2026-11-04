import { describe, expect, it } from 'vitest';

import type { Files, Mutant, ReportFile } from './report';
import { fixture, gateModule } from './report';

/**
 * The mutation gate's survivor baseline, held: `readSurvivors` and
 * `survivorFindings` of `scripts/gates/mutation.js`, over the committed list
 * `scripts/gates/mutation-survivors.json` and a committed cut of a real run.
 *
 * The baseline names each surviving mutant by its file, mutator, the text it
 * replaces and the replacement, and one entry excuses one survivor
 * (`identityOf`). Until E04-M01-S01 it named the line and column, and a line
 * added above a listed mutant turned the gate red on an unchanged guarantee.
 * These cases hold both halves: a listed survivor stays matched wherever its line
 * moves, and a survivor the list does not name, including a second copy of a
 * listed one, is refused.
 *
 * `fixtures/survivor-run.json` holds the two files of S01's full run that carry
 * its two survivors, `src/contracts/bridge.ts` and `src/core/parse/bytes.ts`,
 * with their source and every mutant; its `comment` names the run. The list read
 * is the committed one, so a change to its entries for these two files is a
 * change this check sees: an entry dropped because a test now kills its mutant
 * leaves that mutant here a survivor the list does not name, and the fixture is
 * then cut again.
 */

interface Findings {
  readonly found: readonly string[];
  readonly notes: readonly string[];
}

interface Gate {
  readonly readSurvivors: () => ReadonlyMap<string, readonly unknown[]>;
  readonly survivorFindings: (
    files: Files,
    listed: ReadonlyMap<string, readonly unknown[]>,
  ) => Findings;
}

const gate = await gateModule<Gate>('mutation.js');
const run = (fixture('survivor-run.json') as { readonly files: Files }).files;

const BRIDGE = 'src/contracts/bridge.ts';
const BYTES = 'src/core/parse/bytes.ts';

/** The file of the run, which the fixture must hold. */
function fileOf(files: Files, key: string): ReportFile {
  const file = files[key];
  if (file === undefined) throw new Error(`the fixture holds no ${key}`);
  return file;
}

/** The run with `text` added as a whole line above line `line` of one file, every position below it moved. */
function withLineAbove(files: Files, key: string, line: number, text: string): Files {
  const file = fileOf(files, key);
  const lines = file.source.split('\n');
  lines.splice(line - 1, 0, text);
  const moved = (at: { line: number; column: number }): { line: number; column: number } =>
    at.line >= line ? { ...at, line: at.line + 1 } : at;
  const mutants = file.mutants.map((mutant) => ({
    ...mutant,
    location: { start: moved(mutant.location.start), end: moved(mutant.location.end) },
  }));
  return { ...files, [key]: { source: lines.join('\n'), mutants } };
}

/** The run with one file's mutants changed by `change`. */
function withMutants(
  files: Files,
  key: string,
  change: (all: readonly Mutant[]) => Mutant[],
): Files {
  const file = fileOf(files, key);
  return { ...files, [key]: { ...file, mutants: change(file.mutants) } };
}

/** The listed survivor of a file of the run. */
function survivorOf(files: Files, key: string): Mutant {
  const found = fileOf(files, key).mutants.find((mutant) => mutant.status === 'Survived');
  if (found === undefined) throw new Error(`the fixture's ${key} holds no survivor`);
  return found;
}

/** What the gate says of the run against the committed list. */
const against = (files: Files): Findings => gate.survivorFindings(files, gate.readSurvivors());

describe('a listed survivor stays matched wherever its line moves', () => {
  it('matches both survivors of the recorded run, and refuses nothing', () => {
    const { found, notes } = against(run);
    expect(found).toEqual([]);
    expect(notes[0]).toContain('matched a mutant of this run 2,');
    expect(notes[0]).toContain('survivors of this run not on the list 0');
  });

  it('matches them with a line added at the top of each file', () => {
    const moved = withLineAbove(withLineAbove(run, BRIDGE, 1, '// a line'), BYTES, 1, '// a line');
    expect(survivorOf(moved, BRIDGE).location.start.line).toBe(
      survivorOf(run, BRIDGE).location.start.line + 1,
    );
    expect(against(moved).found).toEqual([]);
  });

  it('matches the bridge constant with an import added right above it', () => {
    const line = survivorOf(run, BRIDGE).location.start.line;
    const moved = withLineAbove(run, BRIDGE, line, "import type { RefreshRequest } from './ipc';");
    expect(against(moved).found).toEqual([]);
  });
});

describe('a survivor the list does not name is refused', () => {
  it('refuses a killed mutant that comes back alive', () => {
    const killed = fileOf(run, BYTES).mutants.find((mutant) => mutant.status === 'Killed');
    const alive = withMutants(run, BYTES, (all) =>
      all.map((mutant) => (mutant === killed ? { ...mutant, status: 'Survived' } : mutant)),
    );
    const { found } = against(alive);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('and is not in scripts/gates/mutation-survivors.json');
  });

  it('refuses a second copy of the listed bridge mutant, which shares its four fields', () => {
    const listed = survivorOf(run, BRIDGE);
    const last = fileOf(run, BRIDGE).source.split('\n').length;
    const copied = withLineAbove(run, BRIDGE, last, "export const SECOND_NAME = 'gitGraphical';");
    const start = { line: last, column: 28 };
    const end = { line: last, column: 42 };
    const twice = withMutants(copied, BRIDGE, (all) => [
      ...all,
      { ...listed, id: 'copy', location: { start, end } },
    ]);
    const { found } = against(twice);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('1 more than the list names');
  });

  it('refuses the entry and the survivor when the listed text is edited', () => {
    const listed = survivorOf(run, BRIDGE);
    const file = fileOf(run, BRIDGE);
    const edited = {
      ...run,
      [BRIDGE]: { ...file, source: file.source.replace("'gitGraphical'", "'gitGraphicaX'") },
    };
    const { found } = against(edited);
    expect(listed.mutatorName).toBe('StringLiteral');
    expect(found).toHaveLength(2);
    expect(found[1]).toContain('which is what an edit to the listed text looks like');
  });
});
