# E04-M01-S06 · Commit details read

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S06 commit details read

Nothing in the window changed in this slice. The window can now ask for the details of one commit of the open
repository, or of its uncommitted changes, on a channel of their own, and is answered with every field the
Commit Details View (S09, S10) will draw: the full hash, the parents' full hashes, author and committer with
their dates, the whole message, and every changed file with its status, its old path when it was renamed, and
its line counts. They are read from git when asked for and at no other time.

## The request, and what it is answered with

`src/contracts/commit-details.ts` holds the shapes: `DetailsTarget` (a commit by its full object name, or the
uncommitted changes), `DetailsRequest`, `DetailsPerson`, `FileStatus`, `ChangedFile`, `CommitDetails`,
`UncommittedDetails` and `DetailsResponse`, a `Result` of either. They are the task's interface with no field
added or renamed. The two kinds of reply carry no tag of their own: the caller knows which it asked for, and a
reply answers one request (`src/app/repository-protocol.ts`).

The path is `CHANNELS.commitDetails` (`repository:commit-details`), the bridge's `commitDetails`, the
preload's entry for it, the main process's handler, which forwards the request unchecked as a `details`
question, the utility process's `details`, which reads in the repository the window has open, and the port's
`readDetails`. A request is checked once, by `detailsTargetOf`, at the top of the adapter's
`readGitDetails` (`src/adapters/git-details.ts`), before anything of it reaches a command line: a hash is
read only when it is 40 or 64 lower-case hexadecimal digits, so `--output=x`, `HEAD~1` or an abbreviated
hash names nothing and is answered with a failure, and no git process starts for it (the fixtures suite
counts none). It is in `src/contracts/` because it is a rule of the request's shape, beside the shape, and
under the mutation gate.

**What fails, and how.** Every failure is a `Result`, never a throw at the window:

- a target that is neither: `FailureKind.GitFailed`, *The details asked for name neither a commit by its full
  object name nor the uncommitted changes.*;
- a full object name the repository holds that is not a commit: git answers a tree's or a blob's name with no
  output and a success, and a tag's with the commit it points at (git 2.51.0, measured on a scratch
  repository), so the reply is a failure whenever the header's own object name is not the one asked for
  (`finishCommitDetails`), `FailureKind.GitFailed`, *`<hash>` is not a commit of this repository.*;
- a name the repository does not hold: git's own message (`fatal: bad object <hash>`), as every other failure
  of git is carried;
- no repository open: `FailureKind.Cancelled`, and a reply read for a repository that another open replaced
  meanwhile is dropped as `Cancelled`, as a page is. A branch selection applied meanwhile does not drop it.

`FailureKind.GitFailed` is not quite right for the first two, which git did not report; the contract has no
kind for a request the application refuses, the same gap E01-M01-S06 raised for the utility process's own
failures, and adding one is a change to `src/contracts/result.ts`, outside this slice.

## A commit: one git process

`commitDetailsArgs` (`src/adapters/git-commands.ts`) is one `git log -1` of the hash, with the overrides every
list carries (`--no-pager`, `--no-optional-locks`, `log.showSignature=false`, `i18n.logOutputEncoding=UTF-8`,
`color.diff=never`, held for the new lists by the completeness case of `git-colour.spec.ts`), and:

- `--format=` `COMMIT_DETAILS_FORMAT`: a record separator, then hash, parents, author name, e-mail and raw
  date, committer name, e-mail and raw date, and the raw message `%B` **last**, cut by the unit separator;
  `--date=raw` and `--no-use-mailmap`, as a page reads them;
- `--root`, so a root commit is read against the empty tree: with `log.showRoot=false`, git 2.51.0 printed a
  root commit with no changed file without it, and every file as added with it;
- `--diff-merges=first-parent`, so a merge lists its changes against its first parent, as the reference does;
  git documents the option from 2.31, so an older git answers this request with its own failure;
- `--raw --numstat -z -M --no-relative`, shared with the uncommitted read (below).

Each measurement here was made by this slice with git 2.51.0 on a scratch repository unless it names a test.
Three overrides that looked necessary were measured and are not given: `--no-textconv` (a configured
`diff.<driver>.textconv` changed a patch and left `--numstat`'s counts as they were, in `log` and in `diff`),
`--no-notes` (`notes.displayRef` added nothing to a `--format` without `%N`) and `--no-ext-diff`
(`diff.external` naming a program that does not exist left `--raw --numstat` as they were, with a success, in
`log` and in `diff`). `-M` is given although `diff.renames` defaults to on: with `diff.renames=false` and no `-M`, git listed a rename as a deletion and an addition, which the
fixtures suite holds (*detects a rename whatever diff.renames says*). `--no-relative` is given because with
`diff.relative=true`, from a folder inside the repository, git listed only the files under that folder by paths
relative to it; the fixtures suite holds a read from `deep/er` under that setting equal to one from the root.

**What the output is.** The header record, ended by the NUL `-z` puts after a commit's formatted text; then
a line feed and the raw entries, `:<mode> <mode> <object> <object> <status>` each followed by its path, or for
a rename the old path and the new one, every path a NUL-ended record; then the line counts,
`<added>\t<deleted>\t<path>`, or for a rename `<added>\t<deleted>\t` followed by the two paths. A binary file
is counted `-` and `-`, read as `null`. A commit that changed nothing ends at the header's NUL. A mode change
alone is counted `0` and `0`.

**The line scope 2 hinges on** is `message: text(parser, record, MESSAGE)` in `headerOf`
(`src/core/parse/commit-details.ts`), reading `%B` as the last field of a record cut only at NUL: the cut of
the header's fields stops at its ninth field (`splitFields` of `./records.ts`), so a message holding a unit
separator, a record separator, a carriage return or any run of spaces, tabs and blank lines arrives as git
stores it. The fixtures suite compares the message with the commit object's own (`git cat-file commit`), and
the unit tests with a message holding each of those.

## The uncommitted changes: two git processes

1. `statusArgs`, the page's own status list (`status --porcelain=v2 --branch --untracked-files=all -z`):
   `# branch.oid` names HEAD's commit, or `(initial)` when there is none, and each `? ` record is an untracked
   file. A rename's record is followed by a record holding the path it came from, which is read past, so an
   old path beginning `? ` is never taken for an untracked file.
2. `uncommittedDiffArgs`: `git diff <base> --raw --numstat -z -M --no-relative`, the working tree against
   `<base>`, which is **the commit the status named**, so a commit made between the two readings cannot set one
   against another HEAD; or, with no commit yet, the SHA-1 empty tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904`,
   which lists every tracked path as added (SHA-1 alone, because the page reads twenty-byte object names alone,
   so a SHA-256 repository does not open). Git compares every path the index holds, so a staged addition and an
   unstaged modification are both listed, each once, against HEAD.

The diff must wait for the status to name its base, so the two run one after the other. The files are the
diff's, in git's order, then the untracked files, in the status's order, each `untracked` with no counts.

**The line scope 3 hinges on** is `args: uncommittedDiffArgs(repositoryPath, status.base)` in
`readUncommitted` (`src/adapters/git-details.ts`), with `[...changed, ...untracked]` in `uncommittedDetailsOf`
(`src/core/parse/uncommitted-files.ts`) beside it: the first is what makes it HEAD's commit as the status saw
it, and the empty tree when there is none; the second is what keeps the untracked files.

## The rules are in the inner rings

The adapter runs git and streams every chunk to a parser; `src/app/` only forwards. Four modules under
`src/core/parse/`, each with its unit tests, are under the mutation gate:

- `nul-records.ts` cuts `-z` output at NUL and nowhere else. `./records.ts` drops a carriage return that ends a
  record, which suits its line-terminated format and the page's fields, and is wrong for a path: a file name may
  end in a carriage return where the file system allows one, and git writes it as it is. Each record is handed
  over as a copy of its own, through one path with no short cut a test could not tell apart;
- `changed-files.ts` reads the raw entries and the line counts and joins them by the new path. Which shape a
  record is follows from the record before it, never from what it holds, so a path beginning with `:`, holding a
  tab or two, a quotation mark or a line feed, or looking like a line count is read as a path;
- `commit-details.ts` reads the header and hands the rest to the changed files;
- `uncommitted-files.ts` reads the status's base and untracked files and puts the details together.

**Decoding is UTF-8.** Every path and field is decoded by `decodeUtf8` (`./bytes.ts`), the WHATWG decoder, so a
path git writes as bytes that are not valid UTF-8 is carried with each ill-formed sequence replaced by U+FFFD:
`bad` `0xFF` `0xC3` `.txt` arrives as `bad��.txt` (unit test of `changed-files.ts`). Such a path cannot be
named back to git from the reply, which a later slice that acts on a file will have to meet.

## The fixture

`details` (`test/fixtures/specification.json`, shape `script`): six commits written by one `fast-import`
stream, then the working tree's changes restored from a seventh commit whose reference is deleted once they
are. `main~4` is a root commit; `main~3`, by two people who differ in name, e-mail, date and offset from UTC,
has a body holding a line indented by four spaces, one indented by a tab and a blank line, and renames
`rename-me.txt` to `renamed.txt` with one line changed, deletes `delete-me.txt`, adds `added.txt`, modifies
`deep/er/still/leaf.txt` (each folder holding one thing) and `binary.dat`, and adds `naïve café 日本.txt`,
`quote"mark.txt`, `question?.txt` and `hash#percent%.txt`; `main~2` deletes the two names Windows refuses; the
merge `main` brings `side.txt` from its second parent. The working tree holds an unstaged modification of the
leaf, a staged addition `staged ✓ #%.txt` and an untracked `untracked ünï.txt`.

**The ASCII `"` and `?`** are written by `fast-import` into the history and into no working tree, on every
platform, rather than into the index alone on the platform that refuses them, so the repository's object names
and working tree are the same everywhere. `fast-import` refuses them on Windows with `core.protectNTFS` on, its
default (git 2.51.0 there: *invalid path 'quote"mark.txt'*), so the stream is run with it off; `main` is checked
out only once neither name is in its tree. A tab, a control character other than a line feed and a name ending
in a carriage return, which no Windows file system holds, are held by the unit tests instead.

**Why it is data.** `test/fixtures/generate.ts` stood at its lint limit of 300 lines of code, so the repository
is spelt out as git steps in the specification and run by `scripted`, and the generator's two workspaces share
`workspaceOf` and its two line lists `linesOf` to make room. Re-recording `expected-object-names.json` added
`details` and changed no other repository's record.

## Tests

- **Units** (`src/core/parse/*.test.ts`, `src/contracts/commit-details.test.ts`): every status letter, a rename
  and a copy, a binary file, a path without counts, the line feed before a commit's first entry, a path holding
  each byte above, a path that is not UTF-8, streams cut into chunks as small as one byte, truncated output,
  and every refusal with its message. Stryker run with the gate's own command and `--mutate` narrowed to the
  four parsers, `src/contracts/commit-details.ts` and the two contract files this slice edits, `ipc.ts` (no
  mutant) and `bridge.ts`: 280 mutants, 278 killed by a failing test, one timed out, and one alive, the
  survivor of `BRIDGE_GLOBAL_NAME` that `scripts/gates/mutation-survivors.json` already lists.
- **Fixtures** (`src/adapters/git-details.spec.ts`): each reply asserted whole, and the git commands each
  request started, counted by `GIT_TRACE2_EVENT` as `test/e2e/budgets-git.spec.ts` counts them: `log` for a
  commit, `status` then `diff` for the uncommitted changes, `log` for a name that is not a commit, and none for
  a target that is not one. A repository with no commit yet lists its staged file as added and its other file as
  untracked.
- **End to end** (`test/e2e/commit-details.spec.ts`): the built application opened on the fixture with a
  user-data directory of its own, the bridge called from the page for `main~3`, the merge and the uncommitted
  changes, and the replies compared with literals; a tree's name and three malformed targets are answered with
  failures.

## Nothing is read on open

An open, a Refresh and a Load More spawn what they spawned at Base: `test/e2e/budgets-git.spec.ts` holds the
counts of `perf/baselines.json`, 6, 5 and 5. With the uncommitted read planted into an open it counted 8 for the
open (`status` and `diff` after the five) and went red, and with the plant removed 6 and green (E04-M01-S06,
2026-11-04; the audit records the runs).

## How long a request takes

Measured by the third case of `test/e2e/commit-details.spec.ts`, which asks five times in turn for HEAD's
details and for the uncommitted changes' over the bridge of the built application and prints each reply's time
from the page's clock; it holds nothing about them. Run on 2026-11-04 (git 2.51.0, Electron 44.3.0), with the
processor load at 100 % (Win32_Processor LoadPercentage, sampled before and after the run) and another project's gates,
another lane's end-to-end run and a review run on the machine:

| fixture | HEAD's details, ms | the uncommitted changes', ms |
| --- | --- | --- |
| `details` | 584, 597, 683, 695, 663 | 1188, 1053, 1416, 1596, 1839 |
| `large` (10 000 commits, a clean working tree) | 655, 464, 715, 670, 716 | 1104, 1368, 1361, 1302, 1203 |

These are readings under load and say what a request costs on a busy machine, not on a free one, which this
lane did not get. They are consistent with a commit's details not growing with the history's length,
which is what one `git log -1` of one hash predicts (an inference from two fixtures, not a series), and with
the uncommitted changes costing about twice a commit's, two processes one after the other. The budget of a request belongs to S09, which draws it.

## Bundle size

The details add 5195 production bytes to `repository.cjs`: 28903 at Base, 34098 here (`npm run gates:size` over
this lane's head, and the same build over a `git archive` of Base, 2026-11-05). Its budget was 28903, its size at
Base, and under the task's ruling it is reset once to the measured size plus the margin rule of
`scripts/gates/size-budget.json`, 35840, with the total moving by the same 6937 bytes to 71449. The entry
`comment-e04-m01-s06` of that file gives the growth by module and what was tried to make it smaller first.
`main.cjs` grows 131 bytes and `preload.cjs` 80, within their budgets, which did not move. The six new modules
are named in `scripts/gates/module-manifest.json`.
