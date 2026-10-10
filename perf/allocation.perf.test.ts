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
 * **Those five processes were one runtime, and the figures belong to it**:
 * {@link MEASURED_UNDER}. What a heap figure reads is V8's doing as much as the
 * product's — the size it gives an object, and what its compilers have removed
 * by the third run — and tolerances of a tenth of a per cent and one per cent
 * were sized against the spread of that one V8, not against the distance between
 * two. E01-M01-FIX-30 ran this gate as it then stood, with no runtime check,
 * once under each of two others on 2026-10-10. Under Node 20.19.5 (V8
 * 11.3.244.8-node.30) the parse read 3 182.339 heap bytes a commit and the gate
 * printed that the product had regressed, which it had not; the layout read
 * 2.276 a row. Under Electron 44.3.0's runtime in Node mode (Node 24.20.0, V8
 * 15.2.124.19-electron.0) they read 1 710.464 and 0.651, the gate passed, and it
 * asked for two typed-array figures of 0 to be committed as baselines; review
 * round 20 had read the same four figures there. So the child reports the
 * runtime it ran under beside its figures, and under any other V8 the case fails
 * **before** it compares anything.
 *
 * What it does not see: allocation outside V8's heap other than typed-array
 * storage, and the renderer's hot path, which runs in Chromium where these
 * switches are not this gate's to set; the frame budget in
 * `test/e2e/budgets-frames.spec.ts` is what holds that path.
 */

const COMMITS = 10_000;
const ROWS = 40_000;
const CHUNK_BYTES = 16 * 1024;

/**
 * The runtime the four allocation entries of `perf/baselines.json` were measured
 * under, and the only one they are held against.
 *
 * **The whole V8 version string has to match, embedder suffix included.** The
 * suffix counts the changes Node has made to that V8 itself, so two strings that
 * differ only there are two different V8s, and nobody has measured whether the
 * heap figures hold across such a step to the one part in a thousand the parse
 * tolerance allows: the two other runtimes read so far (the comment above) are
 * both further away than that. Matching the four numbers alone would let such a
 * step through unseen, and what it could cost is a red saying the product
 * regressed. Matching the whole string costs a re-measurement at every Node
 * release that touches V8, which is five runs of this gate. Node's own version
 * is reported and printed, and not matched: the work measured is this project's
 * code running on V8.
 */
const MEASURED_UNDER = { v8: '13.6.233.17-node.50', node: 'v24.18.0' } as const;

/** The runtime a child ran under, as that child read it from its own process. */
interface Runtime {
  readonly v8: string;
  readonly node: string;
}

/** What the child reports: where it ran, and each workload's two figures per unit of work. */
interface Allocation {
  readonly runtime: Runtime;
  readonly parse: readonly [heapPerCommit: number, buffersPerCommit: number];
  readonly layout: readonly [heapPerRow: number, buffersPerRow: number];
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
  // `process` is the child's own here: this text is bundled and runs nowhere else.
  const runtime = { v8: process.versions.v8, node: process.version };
  const report = { runtime, parse: third(parse, commits), layout: third(layout, rows) };
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

/** What the case says, in place of any comparison, when the child ran under another V8. */
function anotherRuntime(ran: Runtime): string {
  return [
    `The four allocation entries of perf/baselines.json were measured under V8 ${MEASURED_UNDER.v8}`,
    `(Node ${MEASURED_UNDER.node}); this run's child process ran under V8 ${ran.v8} (Node ${ran.node}).`,
    'Nothing was compared, so this failure says nothing about the product: under another V8 the',
    'figures move with the runtime. Either run this gate under the runtime the entries belong to,',
    'or measure all four again under the new one (parseHeapBytesPerCommit,',
    'parseBufferBytesPerCommit, layoutHeapBytesPerRow and layoutBufferBytesPerRow: five runs of',
    'this gate, each a fresh child process) and commit the four together, with the new runtime in',
    'MEASURED_UNDER in perf/allocation.perf.test.ts and in their unit sentences. Never one alone.',
  ].join(' ');
}

describe('allocation on the hot path, counted', () => {
  it('allocates no more per commit parsed, or per row laid out, than it did', async () => {
    const { runtime, parse, layout } = await measure();
    process.stdout.write(`  the child ran under V8 ${runtime.v8}, Node ${runtime.node}\n`);
    expect(runtime.v8, anotherRuntime(runtime)).toBe(MEASURED_UNDER.v8);
    const failed = [
      held('parseHeapBytesPerCommit', 'heap bytes allocated parsing a commit', parse[0]),
      held('parseBufferBytesPerCommit', 'typed-array bytes allocated parsing a commit', parse[1]),
      held('layoutHeapBytesPerRow', 'heap bytes allocated laying out a row', layout[0]),
      held('layoutBufferBytesPerRow', 'typed-array bytes allocated laying out a row', layout[1]),
    ];
    expect(failed).toEqual([false, false, false, false]);
  });
});
