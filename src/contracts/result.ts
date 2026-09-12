/**
 * Why an operation did not produce a value. Always written through one of these
 * names, never as a bare string at a call site.
 */
export const FailureKind = Object.freeze({
  /** No git executable was found where the application looked for one. */
  GitMissing: 'git-missing',
  /** The path exists but git does not consider it a repository. */
  NotARepository: 'not-a-repository',
  /** Git ran and reported a failure of its own. */
  GitFailed: 'git-failed',
  /** The user dismissed a dialog, or the request was superseded. */
  Cancelled: 'cancelled',
} as const);

/** The value of {@link Failure.kind}. */
export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

/**
 * A failure that crossed a process boundary.
 *
 * Errors are values here, not thrown objects: an `Error` does not survive a
 * structured clone with its type or its properties intact, and a boundary that
 * throws makes every caller's failure handling optional.
 *
 * Invariant: `message` is git's own message wherever git produced one. It is
 * never replaced by a friendlier sentence, because the user has to be able to
 * read what git actually said in order to act on it. A friendlier sentence may
 * be shown **in addition**, chosen from `kind`.
 */
export interface Failure {
  readonly ok: false;
  /** Which category of failure this is, for choosing what the view offers. */
  readonly kind: FailureKind;
  /** The message to show the user, verbatim from git when git produced it. */
  readonly message: string;
  /** Git's exit status, when a git process produced this failure. */
  readonly exitCode?: number;
}

/** An operation that produced a value. */
export interface Success<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

/**
 * The reply of anything that can fail. Discriminated on `ok`, so a consumer that
 * forgets to handle the failure does not type-check.
 */
export type Result<TValue> = Failure | Success<TValue>;
