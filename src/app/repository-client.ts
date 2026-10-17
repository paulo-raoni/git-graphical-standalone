import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';

import { FailureKind } from '../contracts/index';
import type { Result } from '../contracts/index';

import type { RepositoryQuestion, RepositoryReply } from './repository-protocol';

/**
 * The main process's half of the seam to the utility process: a forwarder, and
 * nothing else.
 *
 * `docs/ADR-0002-architecture-and-performance.md` decision 2 gives the main
 * process windows, menus and lifecycle, and says it must never block. So this
 * module spawns git nowhere, parses nothing, lays out nothing and waits on no
 * child of its own: it posts a message, keeps the promise that will settle when
 * the answer arrives, and settles it. Everything between those two events
 * happens in another process and on another core.
 *
 * The process is started on the **first request** rather than at launch, so an
 * application opened with no folder costs nothing until the user asks for
 * something, and it is stopped with the last window (`src/app/main.ts`). A
 * utility process outliving its window is this slice's characteristic leak, so
 * the stop is a named step and not a hope about garbage collection.
 */

/** Where the built utility process lives, beside the other bundles. */
const ENTRY_FILE = 'repository.cjs';

/** What Electron calls the process, so that a task list says which one it is. */
const SERVICE_NAME = 'git-graphical-repository';

/** The main process's one handle on the process that reads repositories. */
export interface RepositoryClient {
  /**
   * Ask one question and get its answer.
   *
   * `TValue` is the shape the request's own kind produces, which the caller
   * knows and the wire does not; see `./repository-protocol`.
   */
  readonly ask: <TValue>(question: RepositoryQuestion) => Promise<Result<TValue>>;
  /** End the process, giving its memory back, and fail anything outstanding. */
  readonly stop: () => void;
}

/** One request waiting for its answer. */
type Settle = (result: Result<unknown>) => void;

interface ClientState {
  process: UtilityProcess | null;
  /** Resolved once the process has spawned; nothing may be posted before then. */
  spawned: Promise<void> | null;
  pending: Map<number, Settle>;
  nextId: number;
}

function stopped(message: string): Result<never> {
  return { ok: false, kind: FailureKind.GitFailed, message };
}

/**
 * Fail every outstanding request and forget the process.
 *
 * A promise that never settles is a control that stays disabled for the life of
 * the window, so the death of the process is an answer like any other. The next
 * request starts a new process, which is also what makes a crash recoverable
 * without a restart.
 */
function abandon(state: ClientState, message: string): void {
  const waiting = [...state.pending.values()];
  state.pending.clear();
  state.process = null;
  state.spawned = null;
  for (const settle of waiting) {
    settle(stopped(message));
  }
}

function receive(state: ClientState, message: unknown): void {
  const reply = message as RepositoryReply;
  const settle = state.pending.get(reply.id);
  if (settle !== undefined) {
    state.pending.delete(reply.id);
    settle(reply.result);
  }
}

/** Start the process if it is not running, and answer once it has spawned. */
function started(state: ClientState, entryPath: string): Promise<void> {
  if (state.spawned !== null) {
    return state.spawned;
  }
  const child = utilityProcess.fork(entryPath, [], { serviceName: SERVICE_NAME });
  state.process = child;
  child.on('message', (message: unknown) => {
    receive(state, message);
  });
  child.on('exit', (code: number) => {
    abandon(state, `The process that reads repositories ended with status ${String(code)}.`);
  });
  // Resolved by whichever of the two arrives, because a promise waiting only for
  // `spawn` is a request that never settles and a control disabled for the life
  // of the window — the one failure `abandon` above exists to prevent, reached
  // by a different door.
  //
  // **The door this closes was not reached by the case that looks like it.**
  // Measured here on 2026-09-19 by pointing `ENTRY_FILE` at a bundle that does
  // not exist, building, and starting the application on a repository: the
  // window showed the failure view in 470 to 530 milliseconds with `The process
  // that reads repositories ended with status 1` — identical with this listener
  // and without it — because Electron emits `spawn` first and the child then
  // exits on its own. So this is a guard against a failure to start that emits
  // no `spawn` at all, which is a case this lane could not produce; it is two
  // lines, `resolve` is idempotent, and the alternative to being wrong about it
  // is a window that hangs with no way back.
  state.spawned = new Promise<void>((resolve) => {
    child.once('spawn', () => {
      resolve();
    });
    child.once('exit', () => {
      resolve();
    });
  });
  return state.spawned;
}

/** A client that forks `<distDirectory>/repository.cjs` when first asked. */
export function createRepositoryClient(distDirectory: string): RepositoryClient {
  const state: ClientState = { process: null, spawned: null, pending: new Map(), nextId: 1 };
  const entryPath = join(distDirectory, ENTRY_FILE);

  return {
    ask: async <TValue>(question: RepositoryQuestion): Promise<Result<TValue>> => {
      await started(state, entryPath);
      const child = state.process;
      if (child === null) {
        return stopped('The process that reads repositories could not be started.');
      }
      const id = state.nextId;
      state.nextId += 1;
      const answered = new Promise<Result<unknown>>((resolve) => {
        state.pending.set(id, resolve);
      });
      child.postMessage({ ...question, id });
      return (await answered) as Result<TValue>;
    },
    stop: (): void => {
      const child = state.process;
      abandon(state, 'The process that reads repositories was stopped.');
      child?.kill();
    },
  };
}
