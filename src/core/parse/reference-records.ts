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
  pushRecords,
  splitFields,
  UNIT_MARK,
} from './records';
import type { RecordReader } from './records';

/**
 * `git for-each-ref`, read into a reference list.
 *
 * A stash is a reference in the contract's vocabulary too — `RefKind.Stash` —
 * and until E04-M01-S14 this module read `git stash list` into the same list.
 * Since then the stash list is read before the page's log, because the log needs
 * it, and its entries join this list from `./stash-list.ts`
 * (`addStashReferences`), pointing at each stash's own commit.
 *
 * The format needs no escape. A reference name may not contain an ASCII
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

/** Fields {@link REFERENCE_FORMAT} asks for. */
const REFERENCE_FIELDS = 6;

const REFNAME = 0;
const OBJECT_TYPE = 1;
const OBJECT_NAME = 2;
const DEREFERENCED_NAME = 3;
const SYMREF = 4;
const CHECKED_OUT = 5;

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
