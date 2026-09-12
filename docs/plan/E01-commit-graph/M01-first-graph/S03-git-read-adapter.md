# E01-M01-S03 · The git read adapter, and the log parser

What a reader of the code needs to know about the one place that runs git, and the one place that turns
what it says into the contract types.

## What exists now

Nothing a user sees has changed: the window still opens and says `No repository is open.` What exists is
the layer under it. `src/ports/repository-reader.ts` says what the application needs from a repository;
`src/adapters/` finds git, runs it, and streams its output; `src/core/parse/` turns that output into
`CommitColumns`, `Refs` and `WorkingTree` without holding any of it whole.

Read against this repository — 34 commits, five local branches, two remote-tracking branches, one annotated
tag, five merges and one root — the adapter's answers are identical to what `git log`, `git for-each-ref` and
`git status` print directly. What was compared, and how, is in `AUDIT-S03-git-read-adapter.md`.

## The rings, and what is in each

| ring | what this slice put there |
| --- | --- |
| `src/ports/` | `RepositoryReader`, `PageRequest`, `RepositoryPage`, `ReaderDescription`. Interfaces only. |
| `src/core/parse/` | The parsers. Pure: no process, no file system, no clock, no platform type. |
| `src/adapters/` | Discovery, the process runner, the invocations, and the page assembly. |

The port is named for what it provides rather than for git, because the mechanism is the one replaceable
thing here and an interface called `GitPort` would put it into the vocabulary of every caller.

**`src/core/parse/` may not name a platform type at all**, which is enforced by `gates:boundaries` and, less
obviously, by `tsconfig.inner.json`: that project is compiled with `lib: ["ES2023"]` and `types: []`, so
`TextDecoder` is not merely forbidden, it is not declared. That is why `bytes.ts` decodes UTF-8 by hand. It
implements the WHATWG encoding standard's decoder, replacement characters and all, and
`src/adapters/text-decoding.spec.ts` holds it to that by decoding the same bytes both ways and comparing —
exhaustively over every one- and two-byte sequence, across a spread of three- and four-byte ones, and over
ten thousand pseudo-random sequences.

## What S06 calls

```ts
createGitRepositoryReader(options?: GitReaderOptions): RepositoryReader
```

from `src/adapters/git-repository-reader.ts`. `GitReaderOptions` is `configuredPath`, `platform` and
`environment`, each optional and each defaulting to this process; a caller that passes none gets a reader
that searches the machine it is running on.

```ts
reader.readPage({ repositoryPath, pageSize }): Promise<Result<RepositoryPage>>
reader.describe(): Promise<Result<ReaderDescription>>
```

`RepositoryPage` is `{ commits, refs, workingTree, hasMore }`. It is deliberately **not** a `GraphPage`:
there is no `layout` field, because lane assignment is S04's and putting the two together is S06's.
`describe` reports the git that was found and the version line it printed, which is what a window can show
and what `docs/SETUP.md` records.

Discovery is memoised on success and retried after a failure. "Git is missing" is a state a user fixes while
the application is open, and a cached refusal would be a restart the user should not need.

## The invocations, and why each is shaped that way

Every one of them starts with `--no-pager --no-optional-locks -C <path> -c log.showSignature=false -c
i18n.logOutputEncoding=UTF-8`, and every one is an **argument array**: `spawn` is called with `shell: false`
and no command string is built anywhere, so a repository path holding a space, a quotation mark, an ampersand
or a semicolon is one argument and never a second command.

`--no-optional-locks` is what makes this milestone's promise literally true. `git status` refreshes the index
by default, and refreshing the index is a write to the user's repository that nothing here asked for.

### 1 · Is this a repository at all

```
git … rev-parse --git-dir
```

It runs first and it is the **only** place `FailureKind.NotARepository` comes from. Every other command would
fail the same way on a path that is not a repository, but only this one is asked a question whose whole answer
is whether it is, so only this one can map its failure to that kind without sniffing git's wording. It costs
one process per page; the alternative was to classify another command's failure by matching its message, which
is a string comparison against text that is translated into the user's language.

### 2 · The commits

```
git … log -z --format=<COMMIT_LOG_FORMAT> --date=raw --no-use-mailmap
        --max-count=<pageSize + 1> --branches --tags --remotes --ignore-missing HEAD --
```

- **`--branches --tags --remotes … HEAD`** is this slice's reading of "the branches being shown": every local
  branch, every remote-tracking branch, every tag, and HEAD. It is spelled out rather than written `--all` for
  two reasons a repository shows immediately. `--all` also walks `refs/stash`, which puts a stash's two
  internal commits into the graph as ordinary commits — observed on the `stash` fixture, where `--all` returns
  four commits and this invocation returns two. And in a clone of a hosted repository `--all` also walks
  `refs/pull/*` and `refs/notes/*`, which is history nobody asked to see.
- **`--ignore-missing`** is what lets `HEAD` be named unconditionally. In a repository with no commits HEAD
  resolves to nothing, and without it `git log … HEAD` exits 128 with `ambiguous argument 'HEAD'` — measured on
  a freshly initialised repository. With it, the same repository produces an empty page and exit 0.
- **`--date=raw`** gives `<seconds> <±hhmm>`, which is exactly the two numbers `CommitColumns` keeps: epoch
  seconds in UTC, and the offset in minutes, held apart so no `Date` object is ever retained. Every other date
  format git offers would have to be turned back into these two, and `%ai` loses the difference between an
  offset of `-0000` and one of `+0000`.
- **`--no-use-mailmap`** because `log.mailmap` defaults to true and `PersonTable` says identity is whatever git
  reported **before** a mailmap is applied. It is a command-line option rather than a configuration override so
  that nothing is written over the user's own `log.mailmap`; applying a mailmap is a later milestone's decision
  to take.
- **`--max-count=<pageSize + 1>`** reads one commit more than the page. The extra one is counted and dropped
  rather than stored, which is how `hasMore` is answered without a second walk of the history.
- The trailing **`--`** ends the revisions, so a repository containing a file called `HEAD` cannot turn a
  revision into a path.

### 3 · The references

```
git … for-each-ref --format=<REFERENCE_FORMAT> refs/heads refs/remotes refs/tags
```

`REFERENCE_FORMAT` asks for `%(refname)`, `%(objecttype)`, `%(objectname)`, `%(*objectname)`, `%(symref)` and
`%(HEAD)`.

- `%(objecttype)` being `tag` is what makes `RefFlag.AnnotatedTag`, and `%(*objectname)` is the commit the tag
  dereferences to — the commit the tag decorates, rather than the tag object itself, which is not on the page.
  An annotated tag that dereferences to no commit at all is skipped: it decorates nothing this view draws.
- `%(symref)` being non-empty, and **not** a name ending in `/HEAD`, is what tells `RefKind.RemoteSymbolicHead`
  from a remote branch that happens to be called `HEAD`.
- `%(HEAD)` being `*` is `RefFlag.CheckedOut`.

`RefFlag.DetachedHead` is not in this output at all, because git does not report it. Its documentation says
"the reference it was detached from", and the only record of which reference that literally was is the reflog,
which this milestone does not read. What is available, and is what a reader of the graph wants, is the
reference standing at the same commit: check out a tag and the tag carries the mark. When HEAD is detached at
a commit no reference names, no reference carries it, and `WorkingTree.isDetached` remains the fact itself.

### 4 · The stashes

```
git … stash list -z --format=<STASH_FORMAT>
```

`STASH_FORMAT` asks for `%gd`, `%H` and `%P`. The name kept is `%gd`, which is `stash@{0}` — the reference's
own name, which is what `Refs.names` documents. The object name kept is the stash's **first parent**, which is
the commit the stash was taken on and the commit the reference behaviour asks for; the stash commit itself is
not on the page, because the log above is asked for branches, tags and remotes and not for `refs/stash`.

### 5 · The working tree

```
git … status --porcelain=v2 --branch --untracked-files=all -z
```

Version 2 of the porcelain format is the one with a documented grammar and a branch header. `# branch.oid` is
HEAD's commit or `(initial)` for a branch with no commit yet; `# branch.head` is the branch's short name or
`(detached)`.

`--untracked-files=all` rather than git's default `normal`, because `WorkingTree.untrackedFileCount` is
documented as files and `normal` reports an untracked directory as one entry — a directory of forty new files
would be counted as one.

Only one entry shape spends two records: a rename or a copy writes the new path, a NUL, then the path it came
from. That second record is consumed without being classified, which is the one bit of state the status parser
carries beyond its counts.

## The separators, and what they protect against

`docs/ADR-0001-stack.md` Axis 1 chose the ASCII record and unit separators for the log format and `-z`
termination where git offers it. Concretely:

| stream | record introducer | field separator | record terminator |
| --- | --- | --- | --- |
| `log` | `%x1e` | `%x1f` | NUL, from `-z` |
| `stash list` | `%x1e` | `%x1f` | NUL, from `-z` |
| `for-each-ref` | `%1e` | `%1f` | line feed, which is all `for-each-ref` offers |
| `status --porcelain=v2` | none; the format has its own | space, per the documented grammar | NUL, from `-z` |

**The terminator is the part that has to be unambiguous, and it is.** NUL cannot occur inside a git object's
message, and it cannot occur inside a multi-byte UTF-8 sequence either, since every continuation byte is at
least 0x80. So a record boundary is never a boundary this code invented, and a subject holding a newline, a
tab, a quotation mark, a backslash or a character outside the basic multilingual plane is an ordinary subject.
`for-each-ref` has no `-z`, and the line feed that ends its records is safe for a different reason: every field
of that format is a reference name, an object name or a single marker character, and a reference name may not
contain an ASCII control character at all — `git check-ref-format` enforces it.

**The field separator needed one decision, and it was found by a test rather than by reasoning.** A commit
subject may contain the unit separator, and a record cut at every separator then has more fields than the
format has. The first version of the splitter refused such a record with a `RangeError`, which turns a
legitimate subject into a page that does not load. So `splitFields` takes the caller's field table as the
number of fields asked for, and **once the last field is being filled the separator stops separating**: the
last field runs to the end of its own record. That is why `COMMIT_LOG_FORMAT` puts `%s` last, and why the
record introducer matters — a subject holding `%x1e` is also absorbed, and `afterMark` only ever looks at the
first byte of a record.

What this does **not** protect against is a separator inside an earlier field: an author name containing the
unit separator would shift every field after it, and the record then fails on the date field with a
`SyntaxError` that the adapter turns into `FailureKind.GitFailed`. It fails loudly rather than reading the
wrong columns, which is the property worth having; a format that could not be desynchronised at all is not
available from `git log`.

## Incremental, and what "never held whole" means here

`docs/ADR-0002-architecture-and-performance.md` decision 4. `runGit` reads standard output as a stream and
hands each chunk to its caller as it arrives; `pushRecords` keeps only the bytes of the record it is in the
middle of, in a carry buffer that grows geometrically. A record wholly inside a chunk is handed over as a
**range of that chunk** and is never copied, so the copying is proportional to the number of chunk boundaries
rather than to the size of the output. Each commit is built when its terminator arrives, handed to the sink,
and forgotten: the sink is `appendCommit`, and there is no array of commit objects anywhere on the path.

The parser's two per-commit buffers — the object name and the parent list — are **reused for every commit**,
which is safe for exactly the reason `AppendedCommit` exists: the store copies each field into a column and
lets the object die in the nursery.

Measured, reading the 10 000-commit fixture's log: 2 108 854 bytes arrived in 6 851 chunks, and the largest
single chunk was 9 495 bytes. `git-process.spec.ts` asserts that more than one chunk arrives and that the
largest is smaller than the total, which is the mechanical form of the claim. The audit carries the numbers and
how they were taken.

## Where the failure types come from

Every failure is a value. `src/contracts/result.ts` freezes four kinds, and each one has exactly one origin:

| kind | where it is produced | what it carries |
| --- | --- | --- |
| `GitMissing` | `discoverGit`, when no candidate exists and answers `--version` as git; `runGit`, when `spawn` fails with `ENOENT` | the list of places that were searched |
| `NotARepository` | `readGitPage`, from the failure of `rev-parse --git-dir` and from nowhere else | git's own message |
| `GitFailed` | `runGit`, on a non-zero exit, and on a parser that threw while reading a chunk | git's standard error verbatim, and its exit status when it reached one |
| `Cancelled` | not produced by this slice | — |

Standard error is accumulated — it is the one stream that is, bounded at 64 KB — because
`src/contracts/result.ts` says a failure carries git's own message. A friendlier sentence written here is a
sentence the user cannot act on; one may be shown **in addition**, chosen from `kind`.

The promise `runGit` returns settles on the `close` event and on nothing else, so the process is awaited on
every path: a clean exit, a non-zero exit, a failure to start, and the early termination that follows a parser
throwing — in which case the child is killed and `close` is still what settles the promise.

## The version floor

The git on the development machine is **2.51.0.windows.1**, measured by `git --version` and again by this
adapter's own discovery.

The floor this slice needs is **2.14.0**, and it is raised by `--no-optional-locks`, which git added in that
release. The next highest requirement is `git status --porcelain=v2`, from 2.11.0, and then `%(HEAD)` in
`for-each-ref`, from 2.7.0. Nothing else used here is newer.

**That floor is derived from git's documented history of each option and was not measured.** No git older than
2.51 is installed on this machine and installing one is a machine-level change outside this lane. The floor
`docs/ADR-0001-stack.md` assumes — 2.25 — is therefore **not raised** by this slice, and is met with margin;
the orchestrator records it in `docs/SETUP.md` from the audit.

## What the user's configuration keeps doing

The whole reason `docs/ADR-0001-stack.md` chose the command-line interface is that the user's own setup keeps
working. Two configuration variables are overridden, and nothing else is:

| overridden | why |
| --- | --- |
| `log.showSignature=false` | With it on, `git log` runs the signature verifier and writes its lines into the output between the records. They are not part of the format asked for, so the first signed commit would desynchronise the parser. |
| `i18n.logOutputEncoding=UTF-8` | Git re-encodes a commit message to this encoding on the way out. The parser decodes UTF-8, so a user who has set a legacy encoding would otherwise get mojibake for every message with a character outside ASCII. |

Seven **environment** variables are removed from the child's environment, and everything else the user has set
is passed through untouched: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR` and `GIT_NAMESPACE`. Each one silently overrides the
`-C <path>` this application asked for, so an application launched from a shell inside another repository would
otherwise read that one and say nothing about it.

**The locale is not touched**, so git's diagnostics reach the user in the user's own language; every format read
here is a machine format that a locale does not move. **Colour is not touched**, because `--format` without a
`%C` placeholder emits none and no porcelain format is coloured. Hooks, credential helpers, signing
configuration, `include` directives and everything else stay exactly as the user wrote them.

## Which tests are in which suite, and why

`src/core/parse/**/*.test.ts` is in the **module suite**. It is pure and fast, it inherits the 100 per cent
coverage threshold of `src/core/**`, and it is what the mutation gate runs once per mutant.

`src/adapters/**/*.spec.ts` is in the **fixture suite**, added to `vitest.fixtures.config.js`. These spawn git.
They are `.spec.ts` rather than `.test.ts` on purpose: `vitest.config.js` collects `src/**/*.test.ts`, and a
test that spawns five git processes must not be multiplied by the hundreds of mutants the mutation gate
generates. It is the same extension the end-to-end suite uses, for the same reason.

The adapter suite builds **its own copy** of the fixture repositories, under the temporary directory, by running
the committed generator with the root it takes as an argument. `test/fixtures/repositories/` is rebuilt in place
by the generator's own test, which deletes each repository and writes it again from its first commit, and vitest
runs test files in parallel. Reading those directories while that happens was measured here first as a page that
was missing its newest commits and agreed with git on the older ones — which is what half a rebuilt history
looks like, and is not a shape any assertion would have named. The copy's directory is named after a digest of
`specification.json`, so it is reused between runs and a change to the recipe builds elsewhere rather than
leaving a stale one.

## What is not here

- Lane layout, drawing, and the wiring to the renderer. S04, S05, S06.
- Branch filtering, ordering options, `.mailmap`, reflogs, first-parent walks and avatars. Later milestones.
- Any write to a repository. This milestone reads, and `--no-optional-locks` is what makes that exact.
- `perf/baselines.json`. Parse throughput is measured and reported in the audit; S07 lands the baselines.
- A **bare** repository. `git status` refuses to run in one, so `readPage` returns `GitFailed` with git's own
  words. `WorkingTree` has no way to say "there is no working tree", and inventing one would be a change to a
  frozen contract that two other lanes are writing against this wave. It is raised in the audit, not built.
