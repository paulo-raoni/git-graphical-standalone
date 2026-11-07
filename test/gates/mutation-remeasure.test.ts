import { describe, expect, it, vi } from 'vitest';

import type { Files, Mutant, Run } from './report';
import { fixture, gateModule } from './report';

/**
 * The re-measure clause's verdicts, held: `remeasure` of
 * `scripts/gates/mutation-remeasure.js`, replayed over a committed report with
 * recorded runs in place of the copy of the tree.
 *
 * The clause runs again, alone and after Stryker, every kill whose recorded
 * output gives it nothing to rest on, and counts it by what that second run
 * says. Until this file nothing committed held what it counts: E03-M01's review
 * round 03 removed the starvation guard of `pastTheOuterClock` and every
 * committed check stayed green. Each case below is one verdict, and each is red
 * when that verdict is removed or changed.
 *
 * `fixtures/remeasure-report.json` is cut from a real run of this tree by
 * E04-M01-S01, which its `comment` names with what each mutant and each run was
 * taken from: the kills' recorded outputs, the report's `config`, the dry run's
 * timing Stryker's event recorder wrote, and the outputs of real runs of the
 * per-mutant command. Where a case needs an output no run produced, such as a
 * kill on vitest's clock whose suite also starved, the comment says how it was
 * put together from real ones.
 *
 * The runs are handed in, so no process is started here: what is held is the
 * reading of a run, not the copy of the tree it runs in, which only a real run of
 * the gate exercises.
 */

interface Recorded {
  readonly comment: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly dryRun: { readonly net: number; readonly overhead: number };
  readonly files: Files;
  readonly runs: Readonly<Record<string, Run>>;
  readonly mutants: Readonly<Record<string, string>>;
}

interface Suspect {
  readonly file: string;
  readonly mutant: Mutant;
}

interface Runs {
  readonly open: () => void;
  readonly close: () => void;
  readonly run: (suspect: Suspect | null, budget: number) => Promise<Run>;
}

interface Remeasure {
  readonly remeasure: (
    files: Files,
    label: string,
    findings: string[],
    clock: RegExp,
    given: {
      readonly config: Readonly<Record<string, unknown>>;
      readonly dryRun: { readonly net: number; readonly overhead: number };
      readonly runs: Runs;
    },
  ) => Promise<Files>;
}

interface Gate {
  readonly VITEST_CLOCK: RegExp;
}

const { remeasure } = await gateModule<Remeasure>('mutation-remeasure.js');
const { VITEST_CLOCK } = await gateModule<Gate>('mutation.js');
const recorded = fixture('remeasure-report.json') as Recorded;

/** A recorded run by its name in the fixture. */
function runNamed(name: string): Run {
  const run = recorded.runs[name];
  if (run === undefined) throw new Error(`the fixture records no run named ${name}`);
  return run;
}

/** The fixture's report holding only the mutant of that role, every other mutant of its file left in. */
function reportOf(role: string): { readonly files: Files; readonly id: string } {
  const id = recorded.mutants[role];
  if (id === undefined) throw new Error(`the fixture names no mutant for ${role}`);
  const files: Record<string, Files[string]> = {};
  for (const [key, file] of Object.entries(recorded.files)) {
    if (file.mutants.some((mutant) => mutant.id === id)) files[key] = file;
  }
  return { files, id };
}

interface Replay {
  readonly findings: readonly string[];
  readonly statusOf: (id: string) => string | undefined;
  readonly calls: readonly { readonly id: string | null; readonly budget: number }[];
  /** What the clause printed for the mutant: its verdict, then why. */
  readonly verdict: string;
}

/** The clause over the report of one role, with `second` as every mutant's second run. */
async function replay(role: string, second: string, clean = 'clean'): Promise<Replay> {
  const { files } = reportOf(role);
  const calls: { id: string | null; budget: number }[] = [];
  const findings: string[] = [];
  const runs: Runs = {
    open: () => undefined,
    close: () => undefined,
    run: (suspect, budget) => {
      calls.push({ id: suspect?.mutant.id ?? null, budget });
      return Promise.resolve(runNamed(suspect === null ? clean : second));
    },
  };
  const { config, dryRun } = recorded;
  const printed: string[] = [];
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    printed.push(String(text));
    return true;
  });
  const corrected = await remeasure(files, 'mutation-check', findings, VITEST_CLOCK, {
    config,
    dryRun,
    runs,
  }).finally(() => {
    write.mockRestore();
  });
  const verdict = /\(to ".*"\): (.*)$/m.exec(printed.join(''))?.[1] ?? '';
  const statusOf = (id: string): string | undefined =>
    Object.values(corrected)
      .flatMap((file) => file.mutants)
      .find((mutant) => mutant.id === id)?.status;
  return { findings, statusOf, calls, verdict };
}

describe('a kill re-measured is counted by what its second run says', () => {
  it('a kill naming no failing test, whose second run fails a test, stays a kill', async () => {
    const { findings, statusOf, calls, verdict } = await replay('no failing test', 'failing');
    expect(verdict).toBe('assertion, a test failed');
    expect(findings).toEqual([]);
    expect(statusOf(reportOf('no failing test').id)).toBe('Killed');
    expect(calls.map((call) => call.id)).toEqual([null, reportOf('no failing test').id]);
  });

  it('a kill on vitest clock, whose second run times out on it again, stays a kill', async () => {
    const { findings, statusOf, verdict } = await replay('clock alone', 'clock');
    expect(verdict).toBe("clock, a test ran out of vitest's clock again");
    expect(findings).toEqual([]);
    expect(statusOf(reportOf('clock alone').id)).toBe('Killed');
  });

  it('a kill on vitest clock alone, whose second run passes the outer clock, stays a kill', async () => {
    const { findings, statusOf, verdict } = await replay('clock alone', 'past the outer clock');
    expect(verdict).toBe('clock, ran past the outer clock, alone, as Stryker reports a Timeout');
    expect(findings).toEqual([]);
    expect(statusOf(reportOf('clock alone').id)).toBe('Killed');
  });

  it('a kill whose second run fails a test on a buffer refused to the mutated file stays a kill', async () => {
    const { findings, statusOf, verdict } = await replay('clock and starved', 'own allocation');
    expect(verdict).toBe("assertion, a test failed on the mutant's own allocation");
    expect(findings).toEqual([]);
    expect(statusOf(reportOf('clock and starved').id)).toBe('Killed');
  });

  it('a kill whose second run passes every test is handed on as a survivor', async () => {
    const { findings, statusOf, verdict } = await replay('no failing test', 'passing');
    expect(verdict).toBe('survived, every test passed');
    expect(findings).toEqual([]);
    expect(statusOf(reportOf('no failing test').id)).toBe('Survived');
  });

  it('leaves a kill that names its failing test alone', async () => {
    const { calls, findings } = await replay('failing test', 'passing');
    expect(calls).toEqual([]);
    expect(findings).toEqual([]);
  });
});

describe('a kill neither run says anything about refuses the build', () => {
  it('the starvation guard: a kill on the clock whose suite also starved, past the outer clock', async () => {
    const { findings, verdict } = await replay('clock and starved', 'past the outer clock');
    expect(verdict).toBe('unmeasured, ran past the outer clock, alone');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('ran past the outer clock, alone');
  });

  it('a kill whose second run starves again', async () => {
    const { findings, verdict } = await replay('starved', 'starved');
    expect(verdict).toBe('unmeasured, could not get memory again');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('could not get memory again');
  });

  it('a kill whose second run fails a test on a buffer refused to a file it did not mutate', async () => {
    const { findings, verdict } = await replay('no failing test', 'own allocation');
    expect(verdict).toBe('unmeasured, could not get memory again');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('could not get memory again');
  });

  it('a kill whose second run fails a test on a refused buffer and also lost its worker', async () => {
    const { findings, verdict } = await replay('clock and starved', 'own allocation, worker lost');
    expect(verdict).toBe('unmeasured, could not get memory again');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('could not get memory again');
  });

  it('a kill naming no failing test, past the outer clock', async () => {
    const { findings, verdict } = await replay('no failing test', 'past the outer clock');
    expect(verdict).toBe('unmeasured, ran past the outer clock, alone');
    expect(findings).toHaveLength(1);
  });

  it('every kill chosen, when the copy of the tree fails with no mutant planted', async () => {
    const { findings, calls } = await replay('no failing test', 'failing', 'failing');
    expect(calls.map((call) => call.id)).toEqual([null]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('fails its own suite with no mutant planted');
  });
});

describe('the outer clock is the budget Stryker gives a mutant', () => {
  const factor = Number(recorded.config['timeoutFactor']);
  const absolute = Number(recorded.config['timeoutMS']);

  it('stops each run at timeoutFactor times the dry run, plus timeoutMS, plus the overhead', async () => {
    const { calls } = await replay('no failing test', 'failing');
    const { net, overhead } = recorded.dryRun;
    const strykers = factor * net + absolute + overhead;
    expect(calls[0]?.budget).toBe(strykers);
    expect(calls[1]?.budget).toBe(
      factor * Math.max(net, runNamed('clean').ms) + absolute + overhead,
    );
    expect(calls[1]?.budget ?? 0).toBeGreaterThanOrEqual(strykers);
    expect(strykers).toBeGreaterThan(absolute);
  });
});
