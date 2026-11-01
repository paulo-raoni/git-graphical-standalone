import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { commitLogArgs } from '../src/adapters/git-commands';
import { createCommitLogParser, finishCommitLog, pushCommitLog } from '../src/core/parse/index';
import {
  appendCommit,
  buildCommitColumns,
  createCommitStoreBuilder,
} from '../src/core/store/index';
import { fixture } from '../test/e2e/support/fixtures';

import { compareInRegime, readBaselines } from './baselines';

/**
 * The parse throughput budget of `docs/ADR-0002-architecture-and-performance.md`
 * decision 6 — at least 20 000 commits a second from a streamed log — as a gate.
 *
 * **It runs in `npm run gates:budgets`, not in `gates:perf`.** Its verdict is a
 * time, so it is read on a free machine with the other wall-clock budgets
 * (`AGENTS.md` §11, *Gate tiers*), and the file's name says so: `gates:perf`
 * leaves out every `perf/*.timed.perf.test.ts` and `gates:budgets` runs those
 * and no other file of this folder. A benchmark held to a clock goes in a file
 * named that way; one held to a count does not.
 *
 * **It is held as time per commit, not commits per second.** A throughput is a
 * lower bound, and `compareWithBaseline` fails a number that rises; turned over,
 * 20 000 commits a second is at most 50 microseconds a commit, and a slower
 * parser raises that number exactly as a regression raises every other figure in
 * `perf/baselines.json`. The alternative was a second direction in the
 * comparison, which is a new branch in the one function every gate trusts and a
 * new way for an entry to be read the wrong way round; inverting the unit costs
 * nothing and leaves that function as it is.
 *
 * **What is timed** is what `src/adapters/git-page.ts` does with git's output
 * once it has it: the bytes of `git log`, in the adapter's own format and with
 * the adapter's own arguments, fed to the parser chunk by chunk, each commit
 * appended to a store sized as the adapter sizes it, and the columns built. The
 * bytes are read from git **once, before the clock starts**, so git's own time is
 * not in the figure; the end-to-end load budget in `test/e2e/budgets-start.spec.ts`
 * is the one that pays for git.
 *
 * The repository is the ten-thousand-commit fixture the end-to-end suites share,
 * a straight chain of one parent a commit, so every record carries one parent
 * name; a history of merges carries more bytes a commit and costs more a commit.
 * The chunks are 16 KiB, smaller than every chunk E01-M01-S03 saw arrive from
 * the pipe (9 495 to 32 494 bytes, largest per run), so the figure pays for more
 * chunk boundaries than a real read does, not fewer.
 *
 * S07 read the clock five times after one warm-up pass and compared the
 * **fastest** run: the others differ from it by what else the machine was doing,
 * which is not a property of the parser. **Since E03-M01-FIX-04 (2026-10-29) the
 * timing is twenty-five runs in five batches half a second apart, each run read per
 * a reference**: a fixed arithmetic workload in the same thread, timed ten times
 * before the run and ten after it; the run's time over the middle of those twenty,
 * times `REFERENCE_MILLISECONDS`, is its figure, and the lowest of the twenty-five
 * is compared. E03-M01-S10's lane and review round 05 had read 24.741 and 25.702
 * against 21.87 on an unchanged parser (their readings). In twenty readings FIX-04
 * kept at its base on 2026-10-29 and 2026-10-30, the old reading read 14.118 to
 * 17.088, none red, so FIX-04 did not reproduce that red; twenty of the new reading
 * over the same parser, interleaved with them at 5.9 to 36.8 per cent other load,
 * read 14.06 to 17.301. Planted in the parser, a busy-wait of 6 µs a commit read
 * 20.763 to 21.159, green in three kept readings; of 7 µs, 22.37 to 23.08, red in
 * three of three. The reference does none of the parser's work, so the figure cannot
 * see a regression that slows plain arithmetic in the runtime as much as the parser;
 * the slice document, *Parse and layout throughput*, has the rest.
 */

const CHUNK_BYTES = 16 * 1024;
const COMMITS = 10_000;
/** Batches of timed runs, how many runs each, and the pause between two batches. */
const BATCHES = 5;
const RUNS = 5;
const PAUSE_MILLISECONDS = 500;

const repository = fixture('large', 'large', COMMITS);
const log = execFileSync('git', commitLogArgs(repository, COMMITS + 1), {
  maxBuffer: 256 * 1024 * 1024,
});

/** Parse the whole log once into a fresh store, and say how many commits it held. */
function parseOnce(): number {
  const builder = createCommitStoreBuilder(COMMITS);
  const parser = createCommitLogParser((commit) => {
    appendCommit(builder, commit);
  });
  for (let at = 0; at < log.length; at += CHUNK_BYTES) {
    pushCommitLog(parser, log.subarray(at, at + CHUNK_BYTES));
  }
  finishCommitLog(parser);
  return buildCommitColumns(builder).count;
}

function timed(): number {
  const started = performance.now();
  const count = parseOnce();
  const elapsed = performance.now() - started;
  expect(count).toBe(COMMITS);
  return (elapsed * 1000) / COMMITS;
}

/** Timings of the reference workload before each timed parse, and as many after it. */
const REFERENCE_TIMES = 10;
/**
 * The microseconds a held figure is expressed in: a run's time over the middle of its
 * reference timings, times this, which is about what that middle reads in milliseconds
 * on this machine when it is free: in E03-M01-FIX-04's four readings kept at under 7 per
 * cent other load the median run's middle read 5.69 to 5.73 ms.
 */
const REFERENCE_MILLISECONDS = 6;

const table = new Int32Array(4096);
let mixed = 1;

/** Milliseconds of one pass of the fixed reference workload. */
function referenceOnce(): number {
  const started = performance.now();
  for (let index = 0; index < 1 << 19; index += 1) {
    const slot = Math.imul(index, 40_503) & 4095;
    mixed = (Math.imul(mixed, 31) + (table[slot] ?? 0) + index) | 0;
    table[slot] = mixed;
  }
  return performance.now() - started;
}

/** The middle of `values`, or the upper middle of an even count. */
function middle(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** One timed parse, and the middle of the reference timings around it. */
function timedBeside(): { parse: number; reference: number } {
  const before = Array.from({ length: REFERENCE_TIMES }, referenceOnce);
  const parse = timed();
  const after = Array.from({ length: REFERENCE_TIMES }, referenceOnce);
  return { parse, reference: middle([...before, ...after]) };
}

const pause = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

/** Every timed run and the reference around it, batch by batch, after one warm-up parse. */
async function timedBatches(): Promise<{ parse: number; reference: number }[]> {
  timed();
  referenceOnce();
  referenceOnce();
  referenceOnce();
  const readings: { parse: number; reference: number }[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    if (batch > 0) {
      await pause(PAUSE_MILLISECONDS);
      timed();
    }
    readings.push(...Array.from({ length: RUNS }, timedBeside));
  }
  return readings;
}

describe('the streamed log parser, timed', () => {
  it('parses a commit into the store in no more than fifty microseconds', async () => {
    const readings = await timedBatches();
    const runs = readings.map((each) => each.parse);
    const references = readings.map((each) => each.reference);
    const scaled = runs.map(
      (run, at) => (REFERENCE_MILLISECONDS * run) / (references[at] ?? Number.NaN),
    );
    const fastest = Math.min(...scaled);
    process.stdout.write(
      `  parse: ${String(log.length)} bytes, ${String(COMMITS)} commits, ` +
        `${runs.map((each) => each.toFixed(3)).join(', ')} microseconds a commit, ` +
        `reference ${references.map((each) => each.toFixed(3)).join(', ')} ms, ` +
        `per reference ${scaled.map((each) => each.toFixed(3)).join(', ')} microseconds a commit\n`,
    );
    const baseline = readBaselines()['parseMicrosecondsPerCommit'];
    expect(baseline).toBeDefined();
    const comparison = compareInRegime(
      'microseconds to parse one commit of a streamed log into the store',
      fastest,
      baseline ?? { baseline: 0, unit: 'missing' },
    );
    process.stdout.write(`  ${comparison.failed ? 'FAIL' : 'ok  '} ${comparison.message}\n`);
    expect(comparison.failed).toBe(false);
  });
});
