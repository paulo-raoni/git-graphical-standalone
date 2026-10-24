/**
 * A kill's recorded output as the mutation gate reads it: the text vitest printed,
 * with the terminal's escape sequences taken out.
 *
 * Every clause of the gate reads a captured vitest run with regular expressions:
 * the failing-test and failed-file counters, the two clock readings, the worker
 * pool's own lines, the words of a suite that starved, the mutated file's name in
 * an error, and the lines the excerpt quotes. Each is written for the text, and
 * several are anchored at the start of a line, so a colour code in front of
 * `Tests` or between it and its count is enough to make the reading miss.
 *
 * Whether vitest 5.0.0 prints those codes depends on the environment it starts
 * in, read from its installed code by E03-M01-S03: its colours come from
 * `tinyrainbow`, which turns them on unless `NO_COLOR` is set or `--no-color` is
 * on the command line, and then whenever `FORCE_COLOR` or `CI` is set, the
 * platform is Windows, or `TERM` is not `dumb`; and vitest's own command line
 * turns them off again when `std-env` detects an AI agent (`AI_AGENT`,
 * `CLAUDECODE`, `CLAUDE_CODE` and others) and `FORCE_COLOR` is not set. Measured
 * by S03 with the per-mutant command on this project's development machine: no
 * escape sequence in its output when an agent's session started it, 1 560 in the
 * healthy suite's output once the agent's variables were removed, with `CI` and
 * `GITHUB_ACTIONS` set or not. A GitHub Actions runner sets `CI` and runs no
 * agent, so by that code every kill's output there is coloured and the
 * failing-test counter matches none of them, which is the first
 * continuous-integration run's finding. That is read from the code and
 * reproduced on this machine with the runner's variables, not observed on a
 * runner: the run's own report had expired.
 *
 * So the gate reads plain text, whichever way the run printed. The codes are
 * taken out of each mutant's `statusReason` once, as the report is read, and out
 * of the output of every run the re-measure clause makes, before any reading
 * sees either. On output that carries no escape sequence this is the identity,
 * which is why it moves nothing on a run whose output was already plain.
 *
 * **The line the gate's verdict on a coloured run hinges on is
 * `ESCAPE_SEQUENCE`.** It takes out a control sequence (`ESC [`, parameters and
 * one final byte, which is every code `tinyrainbow` writes), an operating-system
 * command ended by `BEL` or `ESC \`, and a two-character escape, and nothing
 * else: no character that is not part of an escape sequence is removed.
 *
 * A control sequence is also taken out when a line break interrupts it, line
 * break included. Stryker's command runner records a run's output as the chunks
 * it read from the pipe joined with `os.EOL` (`command-test-runner.js` of
 * `@stryker-mutator/core` 10.0.0), so a chunk that ends inside a sequence leaves
 * `ESC [`, a line break and the rest of it. Measured by E03-M01-S03 on its full
 * run in the runner's environment: 2 of 1 316 kills' outputs held one such split
 * sequence each, inside a long diff. A sequence never holds a line break of its
 * own, so the one inside it is the join's and goes with it; left in, the rest of
 * the sequence would start a line, and in front of `Tests` would hide the count.
 */

/** Built from code points: a control character written in a pattern fails `no-control-regex`. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** The line break Stryker's join may have put inside a control sequence. See the header. */
const JOIN = '\\r?\\n';

/** **The line this module hinges on.** One terminal escape sequence. See the header. */
const ESCAPE_SEQUENCE = new RegExp(
  `${ESC}(?:(?:${JOIN})?\\[(?:[0-?]|${JOIN})*(?:[ -/]|${JOIN})*[@-~]` +
    `|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`,
  'g',
);

/** The text with every terminal escape sequence taken out. */
export function plainOutput(text) {
  return String(text).replace(ESCAPE_SEQUENCE, '');
}

/** The report's files with every mutant's recorded output as plain text, nothing else changed. */
export function plainFiles(files) {
  const plain = {};
  for (const [key, file] of Object.entries(files ?? {})) {
    const mutants = (file.mutants ?? []).map((mutant) =>
      mutant.statusReason === undefined
        ? mutant
        : { ...mutant, statusReason: plainOutput(mutant.statusReason) },
    );
    plain[key] = { ...file, mutants };
  }
  return plain;
}
