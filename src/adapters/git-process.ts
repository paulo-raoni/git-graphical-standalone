import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { FailureKind } from '../contracts/index';
import type { Result } from '../contracts/index';

/**
 * Running git once, reading what it says as it says it.
 *
 * Three properties of this module are the ones that matter, and each is a rule
 * of the task rather than a preference.
 *
 * **There is no command string anywhere.** `spawn` is given an argument array
 * and `shell: false`, so a repository path holding a space, a quotation mark, an
 * ampersand or a semicolon is one argument and never a second command.
 *
 * **Standard output is a stream.** Each chunk is handed to the caller as it
 * arrives and then forgotten, so git's whole output is never one string and
 * never one buffer (`docs/ADR-0002-architecture-and-performance.md`
 * decision 4). The largest single allocation on the path is one chunk, which is
 * the pipe's own high-water mark.
 *
 * **Standard error is kept, and it is what the user is shown.** `src/contracts/`
 * says a failure carries git's own message, because a friendlier sentence
 * written here is a sentence the user cannot act on.
 */

/**
 * Variables that redirect which repository git reads.
 *
 * Everything else the user has set is left exactly as it is, which is the whole
 * reason `docs/ADR-0001-stack.md` chose the command-line interface. These seven
 * are removed because each one silently overrides the `-C <path>` this
 * application asked for: an application launched from a shell inside another
 * repository would otherwise read that one and say nothing.
 */
const REDIRECTING = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
];

/**
 * Bytes of standard error kept for the failure message.
 *
 * Git's diagnostics are a few lines. A bound is here because standard error is
 * the one stream that is accumulated, and an unbounded accumulation of something
 * a repository can make arbitrarily long is the shape of an out-of-memory bug.
 */
const STDERR_LIMIT = 64 * 1024;

/** One invocation. */
export interface GitRun {
  /** The git executable, as discovery found it. Never a bare name. */
  readonly executable: string;
  /** Its arguments, already separated. Never a string to be split. */
  readonly args: readonly string[];
  /** Where each chunk of standard output goes, as it arrives. */
  readonly onOutput?: ((chunk: Uint8Array) => void) | undefined;
}

/** What the run collected while it was in flight. */
interface RunState {
  readonly errors: Uint8Array[];
  errorBytes: number;
  /** What the output handler threw, which ends the run and becomes its failure. */
  broke: Error | null;
  /** Whether the process could not be started at all. */
  missing: boolean;
}

/** The environment git is given: the user's own, minus what redirects it. */
export function readingEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (!REDIRECTING.includes(name)) {
      environment[name] = value;
    }
  }
  return environment;
}

/** Everything git wrote to standard error, as text, up to the limit kept. */
function saidOnError(state: RunState): string {
  return Buffer.concat(state.errors).toString('utf8').trim();
}

/** Hand one chunk to the caller, and stop the run if the caller throws. */
function takeOutput(run: GitRun, state: RunState, child: ChildProcess, chunk: Uint8Array): void {
  const sink = run.onOutput;
  if (sink === undefined || state.broke !== null) {
    return;
  }
  try {
    sink(chunk);
  } catch (cause) {
    state.broke = cause instanceof Error ? cause : new Error(String(cause));
    child.kill();
  }
}

/** Keep standard error for the message, up to {@link STDERR_LIMIT}. */
function takeError(state: RunState, chunk: Uint8Array): void {
  if (state.errorBytes >= STDERR_LIMIT) {
    return;
  }
  state.errors.push(chunk);
  state.errorBytes += chunk.length;
}

/** A failure that carries git's exit status only when git reached one. */
function failedWith(message: string, code: number | null): Result<void> {
  if (code === null) {
    return { ok: false, kind: FailureKind.GitFailed, message };
  }
  return { ok: false, kind: FailureKind.GitFailed, message, exitCode: code };
}

/** What the run amounts to, once the process has closed. */
function outcomeOf(run: GitRun, state: RunState, code: number | null): Result<void> {
  if (state.broke !== null) {
    return failedWith(`git output could not be read: ${state.broke.message}`, code);
  }
  if (state.missing) {
    return {
      ok: false,
      kind: FailureKind.GitMissing,
      message: `${run.executable} could not be started`,
    };
  }
  if (code === 0) {
    return { ok: true, value: undefined };
  }
  const said = saidOnError(state);
  return failedWith(said.length > 0 ? said : `git exited with status ${String(code)}`, code);
}

/**
 * Run git to completion.
 *
 * The promise settles on `close` and on nothing else, so the process is awaited
 * on every path: a clean exit, a non-zero exit, a failure to start, and the
 * early termination that follows an output handler throwing. `close` is the
 * event that fires once the streams are done as well as the process, which is
 * what makes "awaited and cleaned up" true rather than likely.
 */
export function runGit(run: GitRun): Promise<Result<void>> {
  return new Promise<Result<void>>((settle) => {
    const state: RunState = { errors: [], errorBytes: 0, broke: null, missing: false };
    const child = spawn(run.executable, [...run.args], {
      env: readingEnvironment(process.env),
      windowsHide: true,
      shell: false,
    });
    child.stdout.on('data', (chunk: Uint8Array) => {
      takeOutput(run, state, child, chunk);
    });
    child.stderr.on('data', (chunk: Uint8Array) => {
      takeError(state, chunk);
    });
    child.on('error', (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT') {
        state.missing = true;
        return;
      }
      state.broke ??= cause;
    });
    child.on('close', (code: number | null) => {
      settle(outcomeOf(run, state, code));
    });
  });
}
