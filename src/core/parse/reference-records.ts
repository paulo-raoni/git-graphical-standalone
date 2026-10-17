import { RefFlag, RefKind } from '../../contracts/index';

import { decodeUtf8 } from './bytes';
import { HEX_NAME_LENGTH } from './object-names';
import { addReference } from './reference-list';
import type { ReferenceList } from './reference-list';
import {
  afterMark,
  createRecordReader,
  fieldFrom,
  fieldTo,
  finishRecords,
  LINE_TERMINATOR,
  NUL_TERMINATOR,
  pushRecords,
  splitFields,
  UNIT_MARK,
} from './records';
import type { RecordReader } from './records';

/**
 * `git for-each-ref` and `git stash list`, read into one reference list.
 *
 * They are one module because they produce one thing. A stash is a reference in
 * the contract's vocabulary — `RefKind.Stash` — and the only difference between
 * the two streams is which git command spells them and what each record's fields
 * mean.
 *
 * Neither format needs an escape. A reference name may not contain an ASCII
 * control character at all, which `git check-ref-format` enforces and this
 * relies on: the line feed that ends a `for-each-ref` record and the separators
 * inside it cannot occur in any field of it.
 */

/**
 * The format asked of `git for-each-ref`.
 *
 * `%(symref)` rather than a name ending in `/HEAD` is what tells a remote's
 * symbolic head from a remote branch that happens to be called `HEAD`, and
 * `%(*objectname)` is the commit an annotated tag dereferences to, which is the
 * commit the tag decorates rather than the tag object itself.
 */
export const REFERENCE_FORMAT =
  '%1e%(refname)%1f%(objecttype)%1f%(objectname)%1f%(*objectname)%1f%(symref)%1f%(HEAD)';

/** The format asked of `git stash list`, whose records `-z` terminates. */
export const STASH_FORMAT = '%x1e%gd%x1f%H%x1f%P';

/** Fields {@link REFERENCE_FORMAT} asks for. */
const REFERENCE_FIELDS = 6;

const REFNAME = 0;
const OBJECT_TYPE = 1;
const OBJECT_NAME = 2;
const DEREFERENCED_NAME = 3;
const SYMREF = 4;
const CHECKED_OUT = 5;

/** Fields {@link STASH_FORMAT} asks for. */
const STASH_FIELDS = 3;

const STASH_NAME = 0;
const STASH_PARENTS = 2;

const LOCAL_PREFIX = 'refs/heads/';
const REMOTE_PREFIX = 'refs/remotes/';
const TAG_PREFIX = 'refs/tags/';

/** What `%(objecttype)` says for an annotated tag. */
const TAG_OBJECT = 'tag';

/** What `%(HEAD)` writes for the reference that is checked out. */
const CHECKED_OUT_MARK = '*';

/** The parser's whole state: the splitter, and the list being filled. */
export interface ReferenceParser {
  readonly reader: RecordReader;
  /** Field bounds of the record being read, reused so a record allocates none. */
  readonly bounds: Uint32Array;
  readonly list: ReferenceList;
}

/** A parser for `git for-each-ref` output, filling `list`. */
export function createReferenceParser(list: ReferenceList): ReferenceParser {
  return {
    reader: createRecordReader(LINE_TERMINATOR),
    bounds: new Uint32Array(REFERENCE_FIELDS * 2),
    list,
  };
}

/** A parser for `git stash list` output, filling the same `list`. */
export function createStashParser(list: ReferenceList): ReferenceParser {
  return {
    reader: createRecordReader(NUL_TERMINATOR),
    bounds: new Uint32Array(STASH_FIELDS * 2),
    list,
  };
}

/** The text of field `index`. */
function text(parser: ReferenceParser, bytes: Uint8Array, index: number): string {
  return decodeUtf8(bytes, fieldFrom(parser.bounds, index), fieldTo(parser.bounds, index));
}

/** Which kind of reference this name is, or `null` for one not shown. */
function kindOf(refname: string, symbolic: boolean): RefKind | null {
  if (refname.startsWith(REMOTE_PREFIX)) {
    return symbolic ? RefKind.RemoteSymbolicHead : RefKind.RemoteBranch;
  }
  if (refname.startsWith(LOCAL_PREFIX)) {
    return RefKind.LocalHead;
  }
  if (refname.startsWith(TAG_PREFIX)) {
    return RefKind.Tag;
  }
  return null;
}

/** The name without the prefix its kind already carries. */
function shortNameOf(refname: string, kind: RefKind): string {
  if (kind === RefKind.LocalHead) {
    return refname.slice(LOCAL_PREFIX.length);
  }
  if (kind === RefKind.Tag) {
    return refname.slice(TAG_PREFIX.length);
  }
  return refname.slice(REMOTE_PREFIX.length);
}

/** Read one `for-each-ref` record into the list, skipping what it does not show. */
function readReference(parser: ReferenceParser, bytes: Uint8Array, from: number, to: number): void {
  const found = splitFields(bytes, afterMark(bytes, from, to), to, UNIT_MARK, parser.bounds);
  if (found !== REFERENCE_FIELDS) {
    throw new SyntaxError(
      `a reference record has ${String(REFERENCE_FIELDS)} fields, not ${String(found)}`,
    );
  }
  const refname = text(parser, bytes, REFNAME);
  const annotated = text(parser, bytes, OBJECT_TYPE) === TAG_OBJECT;
  const kind = kindOf(refname, text(parser, bytes, SYMREF).length > 0);
  if (kind === null) {
    return;
  }
  const at = annotated ? DEREFERENCED_NAME : OBJECT_NAME;
  const target = fieldFrom(parser.bounds, at);
  if (fieldTo(parser.bounds, at) === target) {
    return;
  }
  addReference(
    parser.list,
    kind,
    shortNameOf(refname, kind),
    flagsOf(parser, bytes, annotated),
    bytes,
    target,
    target + HEX_NAME_LENGTH,
  );
}

/** The flag bits this record carries. */
function flagsOf(parser: ReferenceParser, bytes: Uint8Array, annotated: boolean): number {
  const checkedOut = text(parser, bytes, CHECKED_OUT) === CHECKED_OUT_MARK;
  return (checkedOut ? RefFlag.CheckedOut : 0) | (annotated ? RefFlag.AnnotatedTag : 0);
}

/**
 * Read one `stash list` record into the list.
 *
 * The object name kept is the stash's **first parent**, which is the commit the
 * stash was taken on and the commit the reference behaviour asks for. The stash
 * commit itself is not on the page: `git log` here is asked for branches, tags
 * and remotes, and not for `refs/stash`.
 */
function readStash(parser: ReferenceParser, bytes: Uint8Array, from: number, to: number): void {
  const found = splitFields(bytes, afterMark(bytes, from, to), to, UNIT_MARK, parser.bounds);
  if (found !== STASH_FIELDS) {
    throw new SyntaxError(
      `a stash record has ${String(STASH_FIELDS)} fields, not ${String(found)}`,
    );
  }
  const parents = fieldFrom(parser.bounds, STASH_PARENTS);
  if (fieldTo(parser.bounds, STASH_PARENTS) === parents) {
    return;
  }
  const name = text(parser, bytes, STASH_NAME);
  addReference(parser.list, RefKind.Stash, name, 0, bytes, parents, parents + HEX_NAME_LENGTH);
}

/** Feed one chunk of `git for-each-ref` output. */
export function pushReferences(parser: ReferenceParser, chunk: Uint8Array): void {
  pushRecords(parser.reader, chunk, (bytes, from, to) => {
    readReference(parser, bytes, from, to);
  });
}

/** Read a last `for-each-ref` record that arrived without its terminator. */
export function finishReferences(parser: ReferenceParser): void {
  finishRecords(parser.reader, (bytes, from, to) => {
    readReference(parser, bytes, from, to);
  });
}

/** Feed one chunk of `git stash list` output. */
export function pushStashes(parser: ReferenceParser, chunk: Uint8Array): void {
  pushRecords(parser.reader, chunk, (bytes, from, to) => {
    readStash(parser, bytes, from, to);
  });
}

/** Read a last `stash list` record that arrived without its terminator. */
export function finishStashes(parser: ReferenceParser): void {
  finishRecords(parser.reader, (bytes, from, to) => {
    readStash(parser, bytes, from, to);
  });
}
