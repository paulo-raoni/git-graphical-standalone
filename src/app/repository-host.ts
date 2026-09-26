import { createGitRepositoryReader } from '../adapters/git-repository-reader';
import { FailureKind } from '../contracts/index';
import type { GraphPage, Result } from '../contracts/index';
import { createLayoutState, layoutPage } from '../core/layout/index';
import type { LayoutState } from '../core/layout/index';
import { addPage, createRowBlock, FIRST_PAGE_COMMITS } from '../core/page/index';
import type { RowBlock } from '../core/page/index';
import type { ReaderDescription, RepositoryPage } from '../ports/index';

import type { RepositoryReply, RepositoryRequest } from './repository-protocol';

/**
 * The utility process: everything that costs CPU, off the process that owns the
 * window.
 *
 * `docs/ADR-0002-architecture-and-performance.md` decision 2 puts spawning git,
 * parsing its output, building the store and laying out the lanes here, for two
 * reasons: a large load cannot freeze the window from a process that does not
 * own it, and the memory a load allocates is given back to the operating system
 * by ending the process rather than hoped back from a garbage collector. This
 * file is that process's whole program. It imports no Electron module — a
 * utility process has none — and talks over `process.parentPort` alone.
 *
 * It owns exactly three things for as long as a repository is open: the reader,
 * the accumulated row block, and the layout state — and, for as long as it runs,
 * a count of the opens asked for, which is how a late reply is recognised (see
 * *What can be in flight at once* below). The commit store is inside
 * the reader's answer and is rebuilt by every read; see *How a further page is
 * read* below.
 *
 * ### How a further page is read
 *
 * `RepositoryReader.readPage` takes a page size and no offset
 * (`src/ports/repository-reader.ts`), so **Load More asks for the whole page
 * again, larger**. The alternative is to teach the adapter to skip, which is a
 * change to `src/adapters/` and outside this slice's boundary, so it is reported
 * rather than made.
 *
 * What that costs and what it buys are both worth stating, because the choice
 * looks worse than it is. It costs one walk of everything loaded so far per
 * press: the *n*th press reads *n + 1* pages of log, so the presses are linear
 * and the total is quadratic in the number of presses. What it buys is that the
 * layout stays **incremental anyway**. A re-read produces a fresh
 * `CommitColumns` whose prefix is the same commits in the same order, with the
 * parents that were `UNKNOWN_INDEX` now resolved — which is exactly the shape
 * `layoutPage` expects of an appended page, because the lanes it left open
 * remember the *entry of `parentIndices`* they are waiting on and re-read it
 * (S04's slice document, *Appending a page*). So a press lays out only its new
 * rows, and `src/core/page/` appends only those rows, however the commits
 * arrived.
 *
 * The figures are in
 * `docs/plan/E01-commit-graph/M01-first-graph/S06-open-a-repository.md`.
 */

/** The git this process runs. Discovery is inside it, memoised on success. */
const reader = createGitRepositoryReader();

/**
 * Everything one open repository needs between pages.
 *
 * **Its identity is the repository's identity.** An open makes a new one and
 * nothing else does: a Refresh replaces the block and the layout *inside* it,
 * and a Load More appends to them. So `open` still being the object a request
 * captured before its read is exactly "nothing was opened meanwhile", which is
 * what *What can be in flight at once* below turns on.
 */
interface OpenRepository {
  /** The path the repository was opened by, which every later read repeats. */
  readonly path: string;
  /** Which open made this, counted in the order opens were asked for. */
  readonly ticket: number;
  /** Every row laid out so far, appended to and never recomputed. */
  block: RowBlock;
  /** The open lanes the next page continues from. */
  layout: LayoutState;
}

let open: OpenRepository | null = null;

/** How many opens have been asked for, which is the ticket the next one takes. */
let opensAsked = 0;

/**
 * ### What can be in flight at once
 *
 * **Anything.** This process answers every request as it arrives and awaits a
 * read of git in each, so an Open, a Refresh and a Load More can all be reading
 * at the same moment and their reads return in whatever order git finishes them.
 * The renderer disables only the control that started a request, and the bridge
 * can be called without any control at all, so nothing outside this file may be
 * relied on to serialise them.
 *
 * What makes that safe is one rule: **a reading is applied only to the state it
 * was read for.** A Load More or a Refresh captures the open repository before
 * its read and, when the read returns, answers {@link FailureKind.Cancelled} and
 * changes nothing if a different one is open by then — whether the read
 * succeeded or failed, because a failure of the repository that was replaced
 * shown over the one that replaced it is the same defect in another form. An
 * Open takes a ticket before its read and is dropped the same way if an open
 * asked for after it has already been applied.
 *
 * A Refresh and a Load More of the **same** repository are not dropped for
 * overtaking each other, and do not need to be: both are a whole page of the
 * repository the state holds, each leaves the state matching the page it
 * answered, and the renderer draws the reply that arrives last — which is the
 * one applied last, because between deciding a reply and posting it `handle`
 * runs nothing but promise continuations, so no other read can land in between.
 */
function superseded(): Result<never> {
  return failed(
    FailureKind.Cancelled,
    'Another repository was opened while this one was being read, so this reply was dropped.',
  );
}

/** A failure of this process rather than of git, which the contract has no kind for. */
function failed(kind: FailureKind, message: string): Result<never> {
  return { ok: false, kind, message };
}

/** Lay out the new rows of `read`, append them, and produce the page. */
function assemble(repository: OpenRepository, read: RepositoryPage): Result<GraphPage> {
  const rows = layoutPage(repository.layout, read.commits, repository.block.rowCount);
  return { ok: true, value: addPage(repository.block, rows, read) };
}

/**
 * Open `path`, discarding whatever was open before.
 *
 * The state is replaced only once the read has succeeded, so a failed open
 * leaves the repository that was open still open and still loaded — which is
 * what lets the window offer another folder without losing what it was showing.
 *
 * An open whose read returns after an open asked for **later** has been applied
 * is dropped, succeeded or not: the window must end on the folder chosen last,
 * and the reads of two folders finish in whatever order git finishes them.
 */
async function openRepository(path: string): Promise<Result<GraphPage>> {
  opensAsked += 1;
  const ticket = opensAsked;
  const read = await reader.readPage({ repositoryPath: path, pageSize: FIRST_PAGE_COMMITS });
  if (open !== null && open.ticket > ticket) {
    return superseded();
  }
  if (!read.ok) {
    return read;
  }
  const repository: OpenRepository = {
    path,
    ticket,
    block: createRowBlock(),
    layout: createLayoutState(),
  };
  open = repository;
  return assemble(repository, read.value);
}

/** Read `count` more commits of the open repository and append their rows. */
async function loadMore(count: number): Promise<Result<GraphPage>> {
  const repository = open;
  if (repository === null) {
    return failed(FailureKind.Cancelled, 'No repository is open, so there is nothing to add to.');
  }
  const pageSize = repository.block.rowCount + count;
  const read = await reader.readPage({ repositoryPath: repository.path, pageSize });
  if (open !== repository) {
    return superseded();
  }
  if (!read.ok) {
    return read;
  }
  return assemble(repository, read.value);
}

/**
 * Read the open repository again, from a fresh store and a fresh layout state.
 *
 * Fresh rather than appended, because a refresh is the one moment the rows
 * already laid out may be **wrong**: a commit made since the last read goes on
 * the front of the log and moves every row below it down by one, and an
 * amended or rebased commit changes rows in place. Nothing short of laying them
 * out again is correct, and the read that a refresh pays for is the same size as
 * the one an append would have paid.
 *
 * It asks for as many commits as were loaded, and never for fewer than a first
 * page: a repository with five commits loaded and six commits in it would
 * otherwise answer with five and hide the newest one behind a Load More.
 */
async function refresh(): Promise<Result<GraphPage>> {
  const repository = open;
  if (repository === null) {
    return failed(FailureKind.Cancelled, 'No repository is open, so there is nothing to refresh.');
  }
  const pageSize = Math.max(repository.block.rowCount, FIRST_PAGE_COMMITS);
  const read = await reader.readPage({ repositoryPath: repository.path, pageSize });
  if (open !== repository) {
    return superseded();
  }
  if (!read.ok) {
    return read;
  }
  repository.block = createRowBlock();
  repository.layout = createLayoutState();
  return assemble(repository, read.value);
}

/** The answer to one request, as a value; nothing here throws at the caller. */
async function answer(request: RepositoryRequest): Promise<Result<GraphPage | ReaderDescription>> {
  switch (request.kind) {
    case 'open':
      return openRepository(request.path);
    case 'load-more':
      return loadMore(request.count);
    case 'refresh':
      return refresh();
    case 'describe':
      return reader.describe();
  }
}

/**
 * Answer one request, whatever happens.
 *
 * A throw here would end the process and leave the window with a request that
 * never comes back, so everything is turned into the failure value the contract
 * already has for "git did not produce a page". That kind is not quite right —
 * `src/contracts/result.ts` has no kind for a defect of this application — and
 * the audit says so; what it must not do is go missing.
 */
async function handle(port: Electron.ParentPort, request: RepositoryRequest): Promise<void> {
  let result: Result<unknown>;
  try {
    result = await answer(request);
  } catch (error: unknown) {
    result = failed(FailureKind.GitFailed, error instanceof Error ? error.message : String(error));
  }
  const reply: RepositoryReply = { id: request.id, result };
  port.postMessage(reply);
}

const parentPort = process.parentPort;

parentPort.on('message', (event) => {
  void handle(parentPort, event.data as RepositoryRequest);
});
