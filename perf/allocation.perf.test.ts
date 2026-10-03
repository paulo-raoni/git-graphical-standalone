import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

import { commitLogArgs } from '../src/adapters/git-commands';
import { fixture } from '../test/e2e/support/fixtures';

import { compareInRegime, readBaselines } from './baselines';

/**
 * Allocation on the hot path, counted in bytes rather than timed
 * (`docs/ADR-0003-quality-gates-and-ci.md` decision 4).
 *
 * Node has no allocation counter, and the garbage collector frees memory at
 * moments of its own choosing, so the heap's size after a piece of work is
 * normally the work's allocation minus whatever was collected meanwhile. **This
 * gate removes the collection** rather than estimating around it. The work runs
 * in a child Node process started with three V8 switches:
 *
 * - `--expose-gc`, so the heap is collected on purpose just before each run;
 * - `--min-semi-space-size` and `--max-semi-space-size` at 256 MiB, a young
 *   generation larger than anything the runs allocate, so that no collection
 *   runs inside one — `--trace-gc` on the same program, on 2026-09-28, printed
 *   only the collections the program asked for;
 * - `--predictable`, which makes V8 single-threaded and seeds everything it
 *   would otherwise randomise, so that compilation happens at the same points in
 *   every process.
 *
 * With no collection inside a run, the JavaScript heap's growth across it **is**
 * the bytes it allocated there, and the growth of `process.memoryUsage()`'s
 * `arrayBuffers` is the typed-array storage it allocated. Each workload runs
 * three times in the child and the third run is the reading, because the first
 * two are where V8 compiles and optimises the code, and allocation changes as it
 * does: optimised code allocates less.
 *
 * **The heap figures are not quite counters, and their tolerances say by how
 * much.** Measured on 2026-09-28 by running this gate five times, each a fresh
 * child process: the parse read 3168.7272 to 3168.776 heap bytes a commit, a
 * spread of 488 bytes in 31.7 million, and the layout 13.4814 to 13.5118 bytes a
 * row, 1 216 bytes in 540 000 — a residue `--predictable` does not remove. So the
 * parse entry carries a tolerance of 1.001 and the layout entry 1.01, each more
 * than four times its spread, and each still fails a change that allocates one
 * more small object per unit: sixteen bytes more a commit is half a per cent of
 * the parse figure, and sixteen bytes more a row more than doubles the layout's.
 * The typed-array figures were identical in all five and carry no tolerance.
 *
 * What it does not see: allocation outside V8's heap other than typed-array
 * storage, and the renderer's hot path, which runs in Chromium where these
 * switches are not this gate's to set; the frame budget in
 * `test/e2e/budgets-frames.spec.ts` is what holds that path.
 */

const COMMITS = 10_000;
const ROWS = 40_000;
const CHUNK_BYTES = 16 * 1024;

/** What the child reports, per unit of work, for each workload. */
interface Allocation {
  readonly parseHeapPerCommit: number;
  readonly parseBuffersPerCommit: number;
  readonly layoutHeapPerRow: number;
  readonly layoutBuffersPerRow: number;
}

/** A function of the modules the child is given. */
type Imported = (...values: unknown[]) => unknown;

/** Everything the child names: its imports, by name, and nothing else. */
type ChildDependencies = Readonly<Record<string, Imported | undefined>>;

/**
 * The parent columns of a braided page of `rows` commits, which are all the lane
 * layout reads: the shape `perf/layout.perf.test.ts` describes, from the same
 * sequence. Bundled into the child beside {@link childProgram}, so it too names
 * nothing but its parameter.
 */
function braidedParents(rows: number): object {
  let seed = 12345;
  const next = (bound: number): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 16) % bound;
  };
  const parentOffsets = new Uint32Array(rows + 1);
  const parents: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    parentOffsets[row] = parents.length;
    parents.push(row + 1 + next(3));
    if (row % 9 === 0) parents.push(row + 1 + next(40));
  }
  parentOffsets[rows] = parents.length;
  const parentIndices = Uint32Array.from(parents, (at) => (at < rows ? at : 0xffffffff));
  return { count: rows, parentOffsets, parentIndices };
}

/**
 * The child's whole program. **Its source text is what is bundled**, so it names
 * only its parameters and the globals every Node process has; the `import`
 * lines that bind its dependencies are the bundle entry's, below.
 */
function childProgram(dependencies: ChildDependencies, logPath: string, sizes: number[]): void {
  const use = (name: string): Imported => {
    const found = dependencies[name];
    if (found === undefined) throw new Error(`the child was not given ${name}`);
    return found;
  };
  const [commits = 0, rows = 0, chunk = 1] = sizes;
  const log = use('readFileSync')(logPath) as Uint8Array;
  const parse = (): void => {
    const builder = use('createCommitStoreBuilder')(commits);
    const parser = use('createCommitLogParser')((commit: unknown) => {
      use('appendCommit')(builder, commit);
    });
    for (let at = 0; at < log.length; at += chunk) {
      use('pushCommitLog')(parser, log.subarray(at, at + chunk));
    }
    use('finishCommitLog')(parser);
    use('buildCommitColumns')(builder);
  };
  const columns = use('braidedParents')(rows);
  const layout = (): void => {
    use('layoutPage')(use('createLayoutState')(), columns, 0);
  };
  const heap = (): number =>
    (use('getHeapStatistics')() as { used_heap_size: number }).used_heap_size;
  const gc = (globalThis as unknown as { gc: () => void }).gc;
  const third = (work: () => void, units: number): number[] => {
    let reading: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      gc();
      const [heapBefore, buffersBefore] = [heap(), process.memoryUsage().arrayBuffers];
      work();
      reading = [
        (heap() - heapBefore) / units,
        (process.memoryUsage().arrayBuffers - buffersBefore) / units,
      ];
    }
    return reading;
  };
  const [parseHeapPerCommit, parseBuffersPerCommit] = third(parse, commits);
  const [layoutHeapPerRow, layoutBuffersPerRow] = third(layout, rows);
  const report = {
    parseHeapPerCommit,
    parseBuffersPerCommit,
    layoutHeapPerRow,
    layoutBuffersPerRow,
  };
  process.stdout.write(JSON.stringify(report));
}

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'git-graphical-standalone-allocation-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Bundle the child, give it the log, run it under the switches above, and read its report. */
async function measure(): Promise<Allocation> {
  const repository = fixture('large', 'large', COMMITS);
  const logPath = join(scratch, 'log.bin');
  writeFileSync(
    logPath,
    execFileSync('git', commitLogArgs(repository, COMMITS + 1), { maxBuffer: 1 << 28 }),
  );
  const entry = [
    "import { readFileSync } from 'node:fs';",
    "import { getHeapStatistics } from 'node:v8';",
    "import * as parse from '../src/core/parse/index';",
    "import * as store from '../src/core/store/index';",
    "import * as layout from '../src/core/layout/index';",
    `const braidedParents = ${braidedParents.toString()};`,
    `const program = ${childProgram.toString()};`,
    'program({ readFileSync, getHeapStatistics, braidedParents, ...parse, ...store, ...layout },',
    `  process.argv[2], [${String(COMMITS)}, ${String(ROWS)}, ${String(CHUNK_BYTES)}]);`,
  ].join('\n');
  const bundle = join(scratch, 'child.mjs');
  await build({
    stdin: { contents: entry, resolveDir: here, loader: 'ts', sourcefile: 'allocation-child.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'error',
  });
  const switches = [
    '--expose-gc',
    '--predictable',
    '--min-semi-space-size=256',
    '--max-semi-space-size=256',
  ];
  const report = execFileSync(process.execPath, [...switches, bundle, logPath], {
    encoding: 'utf8',
  });
  return JSON.parse(report) as Allocation;
}

const baselines = readBaselines();

function held(key: string, name: string, measured: number): boolean {
  const baseline = baselines[key];
  expect(baseline).toBeDefined();
  const comparison = compareInRegime(name, measured, baseline ?? { baseline: 0, unit: 'missing' });
  process.stdout.write(`  ${comparison.failed ? 'FAIL' : 'ok  '} ${comparison.message}\n`);
  return comparison.failed;
}

describe('allocation on the hot path, counted', () => {
  it('allocates no more per commit parsed, or per row laid out, than it did', async () => {
    const allocation = await measure();
    const failed = [
      held(
        'parseHeapBytesPerCommit',
        'heap bytes allocated parsing a commit',
        allocation.parseHeapPerCommit,
      ),
      held(
        'parseBufferBytesPerCommit',
        'typed-array bytes allocated parsing a commit',
        allocation.parseBuffersPerCommit,
      ),
      held(
        'layoutHeapBytesPerRow',
        'heap bytes allocated laying out a row',
        allocation.layoutHeapPerRow,
      ),
      held(
        'layoutBufferBytesPerRow',
        'typed-array bytes allocated laying out a row',
        allocation.layoutBuffersPerRow,
      ),
    ];
    expect(failed).toEqual([false, false, false, false]);
  });
});
