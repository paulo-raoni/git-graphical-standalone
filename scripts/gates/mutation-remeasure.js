import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { GENERATED, repositoryRoot, walkFiles } from './tree.js';

/**
 * The mutation gate's fifth clause: **no kill rests on a suite that could not get
 * memory, that died before it ran a test, or that printed nothing.**
 *
 * Under Stryker's command runner a mutant is `Killed` when one run of the unit
 * suite exits non-zero, for any reason. The gate's fourth clause caps the share
 * of kills whose output names no failing test at a quarter, which catches a
 * collapse and cannot see a handful, and a handful is what this machine makes.
 * E01-M01-S12 recorded five such kills in two of its seven runs without
 * isolation, and review round 21 one more at `021fba6`, as S12's slice document
 * and E01-M01-FIX-36's task record them; FIX-36 reproduced neither. Their outputs
 * held a vitest worker that exited with the commit limit's status, a
 * `VirtualAlloc failed`, node's own `Out of memory`, nothing at all, and a
 * worker that died before any test file was loaded. S12 traced its five to
 * suites that could not get memory beside a mutant that had taken it; review
 * round 21's had some 2.4 GB free and a cause nobody established. In every case the suite never ran a test, and in every
 * case the gate counted a detection. A mutant that **survives** the tests and
 * meets such a moment is reported killed, and the gate stays green.
 *
 * So every such kill is measured again, here, **alone and after the run**, when
 * the seven workers are gone, by the very command Stryker ran it with
 * (`commandRunner.command` of `stryker.config.json`) and under Stryker's own
 * outer clock (`timeoutMS`), over a copy of the tree with that one mutant
 * planted. A kill is chosen for it when its recorded output names no failing
 * test, or says its suite ran out of memory or lost its worker, whether or not
 * a test failed beside it: a test that failed because the suite could not get
 * memory is no statement about the mutant either. What the second run says is
 * the verdict:
 *
 * - **a failing test**, with no sign of starving: killed, as Stryker said;
 * - **a failed test file and an error that names the mutated file**, with no
 *   failing test and no sign of starving: killed, by its own module breaking on
 *   import, which is the one legitimate kill that names no failing test;
 * - **exit status 0**: it survives the tests, and it goes to the survivor clause
 *   as a survivor, so an unlisted one refuses the build exactly as it would have
 *   if the run had measured it;
 * - **anything else** — starved again, no test and no crash of its own module,
 *   nothing printed, or past the outer clock — refuses the build, naming the
 *   mutant, because neither run says anything about it.
 *
 * The fourth clause is not replaced and its number does not move: it is a
 * validity bound over Stryker's own report, read before this clause and over
 * the kills as Stryker recorded them. A run with more kills to re-measure than
 * `REMEASURED_AT_MOST` is refused without re-measuring any: the most this
 * project has recorded in one run is three, S12's, and re-measuring hundreds
 * would be a second mutation run in the place of a refusal.
 *
 * **The line this clause hinges on is `chosen`**, the predicate that picks the
 * kills to re-measure. Narrow it and a starved kill is counted again; widen it
 * and every honest kill is run twice. `STARVED` is its broad half and is read
 * over the whole output, test frames included: on 2026-10-17 no file of `src/`,
 * `test/`, `perf/` or `scripts/` held any of its phrases, which is what keeps an
 * honest kill's code frame from matching it.
 *
 * The copy of the tree is every file the gates read, which leaves out what a run
 * generates and the lanes' worktrees, with a junction to `node_modules`, under
 * `.stryker-tmp/`, removed when the clause is done. Before any mutant is planted
 * the copy runs the command once with none, as Stryker's dry run does, and a copy
 * that fails it measures nothing: every kill chosen is then refused. Without that
 * run, a copy missing a file a test reads would fail that test for every mutant,
 * and "a test failed" would confirm kills it says nothing about. The mutated file
 * is written from the `source` Stryker recorded in its report, with the mutant's
 * `replacement` over its `location`; the rest of the copy is the working tree,
 * so a replay (`--check-report`) re-measures the mutants of the report it was
 * handed against the tests as they are now.
 */

/** Where the copy of the tree lives while the clause runs. Removed when it is done. */
const SANDBOX = join(repositoryRoot, '.stryker-tmp', `remeasure-${String(process.pid)}`);

/**
 * Vitest's summary counter of failed tests: a copy of `FAILING_TESTS` in
 * `mutation.js`. Should the two part, a kill the gate reads as failing a test
 * and this copy does not is re-measured, and its second run is read by this copy
 * too, so the parting refuses the build, with the output quoted, rather than
 * passing anything quietly.
 */
const FAILING_TESTS = /^\s*Tests\s+\d+ failed\b/m;

/** Vitest's summary counter of failed test files, which a module that breaks on import moves. */
const FAILING_FILES = /^\s*Test Files\s+\d+ failed\b/m;

/** What a suite that could not get memory, or whose worker died, prints. See the header. */
const STARVED =
  /allocation failed|out of memory|OUT_OF_MEMORY|VirtualAlloc failed|exited unexpectedly/i;

/** Beyond this many kills to re-measure, the run is refused instead. Argued in the header. */
const REMEASURED_AT_MOST = 50;

/** How much of an output a refusal quotes, from its end, where vitest prints its verdict. */
const QUOTED_CHARACTERS = 600;

/** **The line this clause hinges on.** A kill whose output gives it no test result to rest on. */
const chosen = (reason) => !FAILING_TESTS.test(reason) || STARVED.test(reason);

/** A report key as a reader's path: repository-relative, with `/` separators. */
function fileNameOf(key) {
  return (isAbsolute(key) ? relative(repositoryRoot, key) : key).split('\\').join('/');
}

/** One mutant named the way the gate names it. */
function nameOf(file, mutant) {
  const { line, column } = mutant.location.start;
  return `${file}:${String(line)}:${String(column)} ${mutant.mutatorName} (to ${JSON.stringify(mutant.replacement ?? null)})`;
}

/** Every killed mutant whose recorded output gives its kill nothing to rest on. */
function suspectsOf(files) {
  const suspects = [];
  for (const [key, file] of Object.entries(files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Killed' && chosen(String(mutant.statusReason ?? ''))) {
        suspects.push({ key, file: fileNameOf(key), source: String(file.source ?? ''), mutant });
      }
    }
  }
  return suspects;
}

/** The source with the mutant's replacement over its location; lines and columns count from one. */
function mutatedSource(source, mutant) {
  const starts = [0];
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) {
    starts.push(at + 1);
  }
  const offsetOf = ({ line, column }) => (starts[line - 1] ?? source.length) + column - 1;
  const { start, end } = mutant.location;
  return (
    source.slice(0, offsetOf(start)) +
    String(mutant.replacement ?? '') +
    source.slice(offsetOf(end))
  );
}

/**
 * The copy of the tree the mutants are planted in, one at a time: every file the
 * gates read, which leaves out what a run generates and the lanes' worktrees.
 */
function makeSandbox() {
  removeSandbox();
  for (const file of walkFiles(repositoryRoot, [...GENERATED, '.worktrees'])) {
    mkdirSync(dirname(join(SANDBOX, file)), { recursive: true });
    copyFileSync(join(repositoryRoot, file), join(SANDBOX, file));
  }
  symlinkSync(join(repositoryRoot, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction');
}

/** The link first, on its own, so that nothing can follow it into the real `node_modules`. */
function removeSandbox() {
  rmSync(join(SANDBOX, 'node_modules'), { force: true });
  rmSync(SANDBOX, { recursive: true, force: true });
  if (existsSync(dirname(SANDBOX)) && readdirSync(dirname(SANDBOX)).length === 0) {
    rmdirSync(dirname(SANDBOX));
  }
}

/** Stop a run and every process it started; on Windows a parent's death leaves its children. */
function stopTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group has already gone, which is what this was for.
  }
}

/** One run of the gate's command in the copy, with its whole output and how it ended. */
function runAlone(command, budget) {
  const [program = '', ...args] = command.trim().split(/\s+/);
  return new Promise((resolveRun) => {
    const child = spawn(program === 'node' ? process.execPath : program, args, {
      cwd: SANDBOX,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const chunks = [];
    let timedOut = false;
    const clock = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, budget);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => chunks.push(Buffer.from(String(error))));
    child.on('close', (code) => {
      clearTimeout(clock);
      resolveRun({ code, timedOut, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

/** What the second run says about the mutant, read in the order the header gives. */
function verdictOf({ code, timedOut, output }, file) {
  if (timedOut) return { verdict: 'unmeasured', why: 'ran past the outer clock, alone' };
  if (code === 0) return { verdict: 'survived', why: 'every test passed' };
  if (STARVED.test(output)) return { verdict: 'unmeasured', why: 'could not get memory again' };
  if (FAILING_TESTS.test(output)) return { verdict: 'assertion', why: 'a test failed' };
  if (FAILING_FILES.test(output) && output.includes(`${file}:`)) {
    return { verdict: 'own crash', why: 'its own module broke a test file on import' };
  }
  return { verdict: 'unmeasured', why: 'no test failed and no error names the mutated file' };
}

/** Each suspect run again, alone, in turn, with the file put back after each. */
async function rerunAll(suspects) {
  const options = JSON.parse(readFileSync(join(repositoryRoot, 'stryker.config.json'), 'utf8'));
  const command = String(options.commandRunner?.command ?? '');
  const budget = Number(options.timeoutMS ?? 120_000);
  const results = [];
  makeSandbox();
  try {
    const clean = await runAlone(command, budget);
    if (clean.timedOut || clean.code !== 0) {
      const why =
        'could not be run at all: the copy of the tree fails its own suite with no mutant planted';
      return suspects.map((suspect) => ({ ...suspect, ...clean, verdict: 'unmeasured', why }));
    }
    for (const suspect of suspects) {
      const target = join(SANDBOX, suspect.file);
      writeFileSync(target, mutatedSource(suspect.source, suspect.mutant));
      const run = await runAlone(command, budget);
      writeFileSync(target, suspect.source);
      results.push({ ...suspect, ...run, ...verdictOf(run, suspect.file) });
    }
  } finally {
    removeSandbox();
  }
  return results;
}

/** The report with every re-measured survivor recorded as one, and nothing else changed. */
function correctedFiles(files, results) {
  const survived = new Map();
  for (const result of results) {
    if (result.verdict === 'survived') survived.set(result.mutant, result.output);
  }
  const corrected = { ...files };
  for (const [key, file] of Object.entries(files ?? {})) {
    if (!(file.mutants ?? []).some((mutant) => survived.has(mutant))) continue;
    corrected[key] = {
      ...file,
      mutants: file.mutants.map((mutant) =>
        survived.has(mutant)
          ? { ...mutant, status: 'Survived', statusReason: survived.get(mutant) }
          : mutant,
      ),
    };
  }
  return corrected;
}

/** The refusal for a mutant neither run says anything about. */
function unmeasuredFinding(result) {
  const tail = result.output.trim().slice(-QUOTED_CHARACTERS) || '(it printed nothing)';
  return `${nameOf(result.file, result.mutant)} was reported killed by a run whose output names no failing test, or says its suite could not get memory or lost its worker, and run again alone after the run it ${result.why}: neither run says anything about the mutant, so it is not counted as a detection. The end of the second run's output: ${tail}`;
}

/** What the clause prints, run or not, so the count is visible on every run. */
function describeResults(label, results) {
  const count = (verdict) => results.filter((one) => one.verdict === verdict).length;
  const lines = [
    `${label}: re-measured alone after the run, ${String(results.length)} killed mutants whose recorded output names no failing test or says the suite could not get memory or lost its worker — ${String(count('assertion'))} failed a test, ${String(count('own crash'))} broke their own module on import, ${String(count('survived'))} survived, ${String(count('unmeasured'))} could not be measured\n`,
  ];
  for (const result of results) {
    lines.push(
      `${label}:   ${nameOf(result.file, result.mutant)}: ${result.verdict}, ${result.why}\n`,
    );
  }
  process.stdout.write(lines.join(''));
}

/**
 * The clause. Re-measures what it must, pushes a refusal into `findings` for
 * every mutant it cannot measure, and returns the report as the survivor clause
 * should read it.
 */
export async function remeasure(files, label, findings) {
  const suspects = suspectsOf(files);
  if (suspects.length > REMEASURED_AT_MOST) {
    findings.push(
      `${String(suspects.length)} killed mutants rest on a run whose output names no failing test or says its suite could not get memory or lost its worker, which is more than the ${String(REMEASURED_AT_MOST)} this gate re-measures one at a time after a run: a run with this many did not measure the tests, so it is refused without re-measuring any of them`,
    );
    return files;
  }
  const results = suspects.length === 0 ? [] : await rerunAll(suspects);
  describeResults(label, results);
  for (const result of results) {
    if (result.verdict === 'unmeasured') findings.push(unmeasuredFinding(result));
  }
  return correctedFiles(files, results);
}
