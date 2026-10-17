/**
 * Every distinct author and committer of a page, interned once.
 *
 * A repository with fifty thousand commits typically has tens of distinct
 * people, so storing each name and address once and referring to it by index is
 * the difference between kilobytes and megabytes of retained strings.
 *
 * A person's identifier **is** its index into these two arrays. There is no
 * separate id field and no object per person.
 *
 * Invariants:
 * - `names` and `emails` have the same length, and are index-aligned: the person
 *   at index `i` is `names[i]` with address `emails[i]`.
 * - An entry is never `undefined`; an unknown address is the empty string.
 * - Identity is whatever git reported, before `.mailmap` is applied. Merging two
 *   spellings of the same human is a later decision, not a property of this
 *   table.
 */
export interface PersonTable {
  /** Display names, index-aligned with {@link PersonTable.emails}. */
  readonly names: readonly string[];
  /** E-mail addresses, index-aligned with {@link PersonTable.names}. */
  readonly emails: readonly string[];
}
