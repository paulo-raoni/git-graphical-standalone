import type { CommitColumns, Refs, Result, WorkingTree } from '../contracts/index';

/**
 * What the application needs from a repository, said without naming git.
 *
 * `docs/ADR-0002-architecture-and-performance.md` decision 1 puts the interfaces
 * `core/` needs from the world in this ring and their implementations in
 * `adapters/`. The name matters: an interface called `GitPort` would put the
 * chosen mechanism into the vocabulary of every caller, and the mechanism is the
 * one thing here that is replaceable. What a caller wants is a page of a
 * repository.
 *
 * This ring holds no implementation. It is interfaces over contract types, so
 * that a parser can be tested without a repository and a view can be built
 * against a reader that does not exist yet.
 */

/** What to read. */
export interface PageRequest {
  /** A path inside the repository, which is where the reader starts looking. */
  readonly repositoryPath: string;
  /**
   * How many commits to read.
   *
   * The reader reads the newest `pageSize` commits of the references it shows,
   * and reports separately whether there are more. "Load More" asks again with a
   * larger size rather than for a delta, which is what `GraphPage` documents: the
   * producing side grows and reuses its buffers, so a whole page costs a memcpy
   * where a delta would cost the consumer a merge step.
   */
  readonly pageSize: number;
}

/** One page of a repository, as the contract holds it. */
export interface RepositoryPage {
  /** The commits of the page, in the order the reader returned them. */
  readonly commits: CommitColumns;
  /** Every reference shown, pointing into {@link RepositoryPage.commits}. */
  readonly refs: Refs;
  /** The working tree, which decides the uncommitted row and what HEAD is called. */
  readonly workingTree: WorkingTree;
  /** Whether commits exist beyond this page, so the view can offer Load More. */
  readonly hasMore: boolean;
}

/** Where the program that reads repositories was found, and which one it is. */
export interface ReaderDescription {
  /** The absolute path the reader is running. */
  readonly program: string;
  /** Its version, exactly as it reports it. */
  readonly version: string;
}

/**
 * The seam between the application and whatever reads repositories for it.
 *
 * Every method answers with a `Result` rather than throwing: an `Error` does not
 * survive a structured clone with its type intact, and a boundary that throws
 * makes every caller's failure handling optional
 * (`src/contracts/result.ts`).
 */
export interface RepositoryReader {
  /** Which reader this is, or why there is none. */
  describe(): Promise<Result<ReaderDescription>>;
  /** One page of the repository, or why it could not be read. */
  readPage(request: PageRequest): Promise<Result<RepositoryPage>>;
}
