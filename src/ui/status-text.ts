import { FailureKind } from '../contracts/index';

/**
 * The words the shell puts around things the rest of the application decided.
 *
 * It is pure — no DOM, no bridge, no state — which is what lets
 * `./status-text.test.ts` sit beside it and run on the unit gate rather than on
 * the end-to-end one.
 */

/** What the bar says when no repository has been opened. */
const NOTHING_OPEN = 'No repository open';

/**
 * The sentence shown above git's own message, chosen from the failure's kind.
 *
 * It is shown **in addition** to git's message and never instead of it, which
 * `src/contracts/result.ts` fixes as the invariant of a `Failure`: the user has
 * to be able to read what git actually said in order to act on it, and a
 * friendlier sentence is not something anyone can act on.
 *
 * Every kind has one, including `Cancelled`, which the view does not show. A
 * total function has no case a reader has to talk themselves out of, and the
 * caller deciding not to show a cancellation is the caller's decision rather
 * than a hole here.
 */
export function failureHeadline(kind: FailureKind): string {
  switch (kind) {
    case FailureKind.GitMissing:
      return 'Git could not be found on this machine.';
    case FailureKind.NotARepository:
      return 'That folder is not a git repository.';
    case FailureKind.GitFailed:
      return 'Git could not read that repository.';
    case FailureKind.Cancelled:
      return 'That request was cancelled.';
  }
}

/** What the control bar shows for the repository it is looking at. */
export function repositoryLabel(path: string | null): string {
  return path === null ? NOTHING_OPEN : path;
}
