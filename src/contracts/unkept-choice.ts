import type { UnkeptChoice } from './ipc';

/**
 * The check a message on `CHANNELS.unkeptChoice` passes before the page sees it.
 *
 * The preload calls it on every message of that channel and hands the page what
 * it answers, never the message itself, as the main process checks every payload
 * the page sends it before using one. Here, in the ring the mutation gate covers,
 * because whether a value is a payload is a decision
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1).
 */

/**
 * The {@link UnkeptChoice} `value` holds, or `null` when it is not one: anything
 * but a value whose `what` and `file` are both strings. The answer is a new object
 * holding those two fields alone.
 */
export function unkeptChoiceOf(value: unknown): UnkeptChoice | null {
  const { what, file } = (value ?? {}) as Partial<Record<string, unknown>>;
  if (typeof what !== 'string' || typeof file !== 'string') {
    return null;
  }
  return { what, file };
}
