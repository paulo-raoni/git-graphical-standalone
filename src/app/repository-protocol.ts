import type { Result } from '../contracts/index';

/**
 * What crosses between the main process and the utility process that reads
 * repositories.
 *
 * It is **not** in `src/contracts/`, and that is the point of it being here.
 * `src/contracts/` is the vocabulary the renderer shares, carried over an
 * allow-listed bridge to a sandboxed page; this is an internal seam between two
 * processes of the same application, both of which are `src/app/`. Putting it in
 * the contract would widen the snapshot `gates:contract` records with something
 * no consumer of the contract can reach.
 *
 * Every request carries an `id` and every reply carries the `id` it answers,
 * because the port is one duplex channel and nothing about it says replies come
 * back in order. An open, a refresh and a load can all be in flight at once — the
 * renderer disables the control that started each one, not the others, and the
 * bridge can be called with no control at all — and a reply matched by arrival
 * order would hand one request's answer to another.
 *
 * Matching by `id` says which request a reply answers, not whether its answer
 * still applies. That is the utility process's to decide, and it decides it in
 * one place: a load or a refresh whose read returns after a different repository
 * was opened, and an open overtaken by an open asked for after it, is answered
 * with a `FailureKind.Cancelled` failure and changes nothing
 * (`./repository-host.ts`, *What can be in flight at once*).
 */

/** One question for the process that owns the reader, the store and the layout. */
export type RepositoryQuestion =
  | {
      /** Open this repository and read its first page, discarding any other. */
      readonly kind: 'open';
      /** An absolute path to a working tree or to a directory inside one. */
      readonly path: string;
    }
  | {
      /** Read `count` more commits of the open repository and append them. */
      readonly kind: 'load-more';
      readonly count: number;
    }
  | {
      /** Read the open repository again from a fresh store and a fresh layout. */
      readonly kind: 'refresh';
    }
  | {
      /** Report which git this is, or why there is none. */
      readonly kind: 'describe';
    };

/**
 * A question with the number its answer will carry back.
 *
 * The intersection distributes over the union, so each arm keeps its own fields
 * and `kind` still narrows them.
 */
export type RepositoryRequest = RepositoryQuestion & { readonly id: number };

/**
 * One answer.
 *
 * The value's shape is decided by the request the `id` names — a `GraphPage` for
 * the first three, a `ReaderDescription` for the last — so it is `unknown` here
 * and is narrowed at the one place that knows which question it asked. A tagged
 * union would carry the tag over the wire and still be narrowed by a cast on
 * arrival, because nothing type-checks a structured clone.
 */
export interface RepositoryReply {
  readonly id: number;
  readonly result: Result<unknown>;
}
