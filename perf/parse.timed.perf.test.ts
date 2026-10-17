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
 * The clock is read five times after one warm-up pass and the **fastest** run is
 * the one compared: the others differ from it by what else the machine was doing,
 * which is not a property of the parser.
 */

const CHUNK_BYTES = 16 * 1024;
const COMMITS = 10_000;
const RUNS = 5;

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

describe('the streamed log parser, timed', () => {
  it('parses a commit into the store in no more than fifty microseconds', () => {
    timed();
    const runs = Array.from({ length: RUNS }, timed);
    const fastest = Math.min(...runs);
    process.stdout.write(
      `  parse: ${String(log.length)} bytes, ${String(COMMITS)} commits, ` +
        `${runs.map((each) => each.toFixed(3)).join(', ')} microseconds a commit\n`,
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
