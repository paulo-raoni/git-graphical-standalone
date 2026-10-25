# E03-M01-S09 · Branch selection reaches git

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S09 branch selection reaches git

Nothing in the window changed in this slice. What changed is that a page can be asked for under a **branch
selection** — some branches only, remote-tracking branches shown or not — and that the choice travels from the
bridge to git and is kept by the process that reads repositories. The Branches dropdown that will ask for it is
E03-M01-S10's; this document is what that slice calls.

The reference behaviour it implements was observed in Git Graph 1.30.0 by an observer session on 2026-10-25
and recorded in this slice's task; this lane did not observe the extension again. In short: Show All shows every
branch, local and remote, with tags and the uncommitted row; one or more selected branches show the union of
their histories, laid out from those commits alone, with every other label that points at a shown commit kept;
a remote branch can be selected like a local one; unchecking Show Remote Branches drops the commits only remote
branches reach and every remote label; the uncommitted row shows exactly when the current branch's commit is in
the graph; Refresh and Load More keep the choice.

## The selection

`BranchSelection`, in `src/contracts/ipc.ts`:

| field | meaning |
| --- | --- |
| `branches: null` | every branch: every local branch, every remote-tracking branch while they are shown, every tag, and HEAD |
| `branches: string[]` | the union of the histories of the branches named, and nothing else: no tag, no HEAD |
| `showRemoteBranches` | whether remote-tracking branches are read and labelled at all |

The four cases of the reference behaviour are `{ branches: null, showRemoteBranches: true }` (the default, and
what a repository opens on), a list of one or more names, a list holding a remote-tracking name, and
`showRemoteBranches: false` with either kind of `branches`.

**Names are full reference names**: `refs/heads/<branch>` for a local branch and
`refs/remotes/<remote>/<branch>` for a remote-tracking one. A `Refs` block names a local branch `main` and a
remote one `origin/main`, with the kind beside it; S10 builds the full name from those two. The prefix is what
the shape is argued from:

- **A short name is ambiguous, and git resolves the ambiguity against the person.** On a scratch repository with
  a branch `side` and a tag `side`, git 2.51.0 resolved `side` to the tag, printing `warning: refname 'side' is
  ambiguous`, and resolved `refs/heads/side` to the branch (measured by this lane). A local branch called
  `origin/main` beside the remote-tracking `origin/main` is the same trap between the two kinds of branch.
- **A full name cannot be read by git as an option.** The list comes from the renderer and ends up on a command
  line. The adapter reads a name only when it begins with `refs/heads/`, or with `refs/remotes/` while remote
  branches are shown, so no name can begin with `-`, and no tag, `HEAD` or `refs/stash` can ride in under a
  branch's name. Anything else is not read.

An empty list reads no commit. It is not a second spelling of every branch: S10 sends `null` for Show All.

## The git arguments for each case

The log's revisions come from `revisionArgs` in `src/adapters/git-commands.ts`; the reference namespaces from
`referenceArgs`.

| case | log revisions | references read |
| --- | --- | --- |
| every branch, remotes shown | `--branches --tags --remotes --ignore-missing HEAD` | `refs/heads refs/remotes refs/tags` |
| every branch, remotes hidden | `--branches --tags --ignore-missing HEAD` | `refs/heads refs/tags` |
| selected, remotes shown | `--ignore-missing` and each name read | `refs/heads refs/remotes refs/tags` |
| selected, remotes hidden | `--ignore-missing` and each `refs/heads/` name | `refs/heads refs/tags` |
| a selection naming no branch that is read | no log is run; the page has no commit | as above |

**The default is the arguments read before this slice, exactly.** `src/adapters/git-selection.spec.ts` holds the
whole log and reference argument lists, written out by hand from this slice's base `4c7ff80`, against
`commitLogArgs` and `referenceArgs` called with no selection and with every branch and remotes shown. The line
that guarantee hinges on is the first arm of `revisionArgs`, `['--branches', '--tags', '--remotes',
'--ignore-missing', 'HEAD']`: with `--tags` and `--remotes` swapped in it, that case went red and every
other case of the spec stayed green (one run, by this lane, on 2026-10-25).

**References are read whatever is selected**, so a branch that is not selected keeps its label on a commit a
selected branch reaches — `origin/feature` labels row 1 of a page of `feature` alone — and a reference whose
commit is not on the page points at `UNKNOWN_INDEX`, as any reference past a page always has.

**A name git does not resolve** — a branch deleted since it was chosen — is skipped, through `--ignore-missing`,
and the rest are read. A selection whose every name is skipped reads no commit and does not fail. Measured with
git 2.51.0 on a scratch repository: `log --ignore-missing refs/heads/gone --` printed nothing and exited 0;
`log --ignore-missing refs/heads/gone refs/heads/side --` printed `side`'s history; without
`--ignore-missing` the first failed with `bad revision`. The fixture suite holds both on the `remotes` fixture.

**Why a selection that names nothing runs no log.** A log given no revision at all walks HEAD: `log
--ignore-missing --` printed HEAD's history (same measurement). So a selection of `[]`, or of names none of
which is read, would show HEAD's history instead of the nothing it names. `selectsAnyRevision` says whether there
is anything to walk, and `readCommits` in `src/adapters/git-page.ts` returns an empty page without running the
log when there is not. `--ignore-missing` stays first in a selection's revisions for the reason it is there on
every branch: naming something that may resolve to nothing must be an empty answer, not a fatal one.

## The working-tree row

**The rule:** on every branch, the page carries the working tree as it is, wherever HEAD's commit lands, which is
what it did before. Under a selection it carries it only when HEAD's commit is **among the commits read** — the
page's own `headCommitIndex` is a row and not `UNKNOWN_INDEX`. Otherwise the page **withholds** it.

**Where it lives:** `shownWorkingTree` in `src/core/page/shown-working-tree.ts`, called by the adapter's
`assemble` on the working tree it has just built. It is a decision that can be wrong, so it is in `src/core/`
(ADR-0002 decision 1) and under the mutation gate; it decides what a page shows, which is what `src/core/page/`
holds; and the adapter only obtains bytes and hands them over.

**How the contract says "none":** a withheld working tree is the existing `WorkingTree` with `hasChanges` false,
both counts 0 and `headCommitIndex` `UNKNOWN_INDEX`; `headRefName` and `isDetached` are still the repository's.
`src/contracts/working-tree.ts` says so in its own text, and `hasChanges` is now documented as whether the page
shows anything uncommitted. The shape did not change, and the reasons are three:

- The view draws the row from `hasChanges` alone (`src/ui/row-model.ts`, `src/ui/graph-canvas.ts`), so a
  withheld tree draws correctly with no change to `src/ui/`, which is S10's.
- Counts of 0 keep the invariant that `hasChanges` is true exactly when a count is not.
- A new required field on `WorkingTree` or `GraphPage` could not be added inside this slice's boundary:
  `buildWorkingTree` in `src/core/parse/` and the page built by hand in `test/e2e/graph-table.spec.ts` both
  construct those types and are outside it. An optional field would have been one whose absence means
  something, on a reply.

What it costs is said rather than hidden: a selected branch whose history reaches HEAD's commit only below the
first page shows the row once a Load More has read that far, and not before.

## How the selection travels: the refresh channel carries it

No new channel. `RefreshRequest` gained an optional `selection` and `OpenRepositoryRequest` an optional
`showRemoteBranches`:

- `refresh({ selection })` **applies** a selection and answers its first page (`FIRST_PAGE_COMMITS`), laid out
  from nothing.
- `refresh({})` re-reads under the selection in force, as many commits as are loaded, as before.
- `loadMoreCommits({ count })` reads under the selection in force, as before.
- `openRepository({ path, showRemoteBranches })` opens on every branch, with remote branches shown unless the
  field is `false`. S10 keeps the per-repository choice in the renderer and passes it here; nothing is stored by
  this slice.

Why the refresh channel rather than a new one: applying a selection *is* a refresh in every respect the
utility process cares about — a whole first page read again, laid out from a fresh block and a fresh layout
state, replacing what was shown — so a second channel would be a second spelling of the same operation, one
more entry in the allow-list of `src/preload/bridge.ts` and one more handler in the main process. The main
process forwards the open and refresh requests **whole**, the request spread into the question with its `kind`
written over it (`src/app/handlers.ts`). `main.cjs` measured 5 096 production bytes at this slice's head against
5 095 at its base, both by `npm run gates:size` on 2026-10-25, so its budget of 5 120 was not reset. The
open handler's forwarding a request whole instead of naming `path` is what paid for the refresh handler's
parameter; the two were not measured apart.

### What the utility process keeps, and what it drops

`src/app/repository-host.ts` keeps the selection in its per-repository state, `OpenRepository`, beside the block,
the layout and the object names the block was laid out from. **Applying a selection replaces that state with a new
object**, exactly as opening a repository does, and every read is made under the `selection` of the state it will
be applied to. So:

- A Load More or a Refresh whose read returns after a selection was applied finds a different state open and is
  answered `FailureKind.Cancelled`, the way a reply of a replaced repository already was. **A page read under one
  selection is therefore never appended to a block laid out under another**: `continuesBlock` is only ever asked
  about a block and a reading of the same state. The line this hinges on is `if (open !== repository)` in
  `loadMore` — with it replaced by a comparison of paths, the end-to-end race case drew an every-branch page
  over the `topic` selection asked for last and failed, in each of the runs this lane made of it on 2026-10-25
  (two with every race, two with only the two whole-history races).
- Opens and selections take numbers from one count. A selection is dropped if a different repository is open
  when its read returns, or if a selection asked for after it has already been applied; an open is dropped, as
  before, if an open asked for after it has been applied. Whatever order the reads finish in, the window ends on
  the folder opened last and, in it, on the selection asked for last.
- A selection whose read fails leaves the selection in force as it was, loaded.

## The fixture

`remotes` in `test/fixtures/specification.json`, built by `remotes` in `test/fixtures/generate.ts`:

- `main`: a trunk of 5 000 commits, written by `largeHistory`'s `fast-import` stream, then a merge of `topic`;
  checked out over a modified file and an untracked one, as `dirtyWorkingTree` leaves it.
- `feature` (3 commits) and `topic` (2 commits) cut 5 and 3 commits below the trunk's end; `release` 30 below.
- `origin/only-remote`: 2 commits cut 8 below the trunk's end that no local branch reaches; its local branch is
  deleted in the same `update-ref` transaction that writes it. `origin/main` is the trunk's end (one behind
  `main`), `origin/feature` one behind `feature`, and `origin/HEAD` names `origin/main`.
- The lightweight tag `light` and the annotated tag `annotated` on the trunk.

5 008 commits in all. The trunk is 5 000 long for the end-to-end race (below): the first page of a selection has
to be much cheaper than a Load More of the whole history, so that the Load More's reply reliably comes back after
the selection has been applied.

The second shape the task allowed, with at least 1 000 branches and 500 tags, **was not added**: its recorded
`show-ref` lines would put some 1 500 lines into `expected-object-names.json`, which is a cost here, and S11 is
the slice that needs it.

## What proves it

- `src/adapters/git-selection.spec.ts` (the fixtures suite): the default's argument lists; every branch with
  remote-only commits and labels; one local branch, with the labels of unselected branches kept and the working
  tree withheld; `main` selected, with it carried; a page smaller than the selected history; two branches; a
  remote-only branch; remotes hidden, with every branch and with a remote branch named; a deleted name beside a
  live one, alone, and a selection naming no branch. Every page is compared with `git log` of the same revisions.
- `src/adapters/git-page.spec.ts` reads `remotes` with every other shape.
- `src/core/page/shown-working-tree.test.ts`: the rule, at 100 % coverage inside the mutation scope.
- `test/e2e/branch-selection.spec.ts`, through the bridge of the built application only: each selection's page,
  labels and uncommitted row; an open without remote branches kept through Refresh and Load More; Load More and
  Refresh under a selection, with the appended layout equal to the one a Refresh lays out; and five races of
  selections against Load More and Refresh, each of which must end with the page of the selection asked for last
  drawn last and kept. The last two races ask for a Load More of the whole history right after a selection; the
  first three depend on timing.

## What S10 calls

| to | call |
| --- | --- |
| open a repository with the remembered remotes choice | `openRepository({ path, showRemoteBranches })` |
| show some branches | `refresh({ selection: { branches: ['refs/heads/…', 'refs/remotes/…'], showRemoteBranches } })` |
| Show All | `refresh({ selection: { branches: null, showRemoteBranches } })` |
| toggle Show Remote Branches | `refresh({ selection })` with the branches in force and the new flag |
| Refresh and Load More | unchanged: `refresh({})`, `loadMoreCommits({ count })` |

Each answers a whole `GraphPage`, drawn like any other. A reply answered `FailureKind.Cancelled` was overtaken and
is not drawn, which is what `src/ui/renderer.ts` already does with one. S10 has to keep, on its side, which
selection the control shows: the utility process keeps the one it last applied, and does not report it back.
