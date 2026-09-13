/**
 * What a reference is. Stored as a `Uint8Array` entry in {@link Refs.kind}, and
 * always written through one of these names so that no bare number appears at a
 * call site.
 */
export const RefKind = /* @__PURE__ */ Object.freeze({
  /** A local branch, `refs/heads/*`. */
  LocalHead: 0,
  /** A remote-tracking branch, `refs/remotes/<remote>/<branch>`. */
  RemoteBranch: 1,
  /** A tag, `refs/tags/*`, lightweight or annotated. */
  Tag: 2,
  /** A remote's symbolic HEAD, `refs/remotes/<remote>/HEAD`. */
  RemoteSymbolicHead: 3,
  /** A stash entry, `refs/stash` and its reflog. */
  Stash: 4,
} as const);

/** The value of one {@link Refs.kind} entry. */
export type RefKind = (typeof RefKind)[keyof typeof RefKind];

/**
 * Bits of one {@link Refs.flags} entry. Combined with bitwise or, tested with
 * bitwise and. Always written through one of these names.
 */
export const RefFlag = /* @__PURE__ */ Object.freeze({
  /** This reference is the one currently checked out. */
  CheckedOut: 1,
  /** This tag is an annotated tag object, not a lightweight ref. */
  AnnotatedTag: 2,
  /**
   * `HEAD` is detached, and this reference stands at the commit it is detached
   * at.
   *
   * **Position, not history.** Git records which reference a detached `HEAD`
   * was detached *from* nowhere except the reflog, which this milestone does
   * not read, so the only thing that can be produced from the commands it runs
   * is which references happen to point at the same commit as the detached
   * `HEAD`. Several references may, and then every one of them carries this
   * flag; none may, and then no reference carries it even though `HEAD` is
   * detached.
   */
  DetachedHead: 4,
} as const);

/** The value of one bit of a {@link Refs.flags} entry. */
export type RefFlag = (typeof RefFlag)[keyof typeof RefFlag];

/**
 * Every reference of the repository in one columnar block, for the same reason
 * commits are columnar: a repository can carry thousands of tags, and an object
 * per tag is retained memory that buys nothing.
 *
 * Invariants:
 * - every array has `count` entries, except `nameOffsets`, which has
 *   `count + 1`;
 * - `nameOffsets` is non-decreasing, starts at 0, and `names.length` equals
 *   `nameOffsets[count]`; reference `i` is
 *   `names.slice(nameOffsets[i], nameOffsets[i + 1])`;
 * - `kind[i]` is one of the {@link RefKind} values;
 * - `flags[i]` is a bitwise or of {@link RefFlag} values and nothing else;
 * - `commitIndex[i]` is a valid index into the page's `CommitColumns`, or
 *   `UNKNOWN_INDEX` when the commit it points at has not been loaded.
 */
export interface Refs {
  /** Number of references in this block. */
  readonly count: number;
  /** One {@link RefKind} per reference. */
  readonly kind: Uint8Array;
  /** Index of the commit each reference points at, or `UNKNOWN_INDEX`. */
  readonly commitIndex: Uint32Array;
  /**
   * Offsets into {@link Refs.names}, in UTF-16 code units, `count + 1` entries.
   */
  readonly nameOffsets: Uint32Array;
  /**
   * Every reference name concatenated into one string, no separators. Names are
   * stored as git reports them, without the `refs/heads/` style prefix that the
   * kind already carries.
   */
  readonly names: string;
  /** One bitwise or of {@link RefFlag} values per reference. */
  readonly flags: Uint8Array;
}
