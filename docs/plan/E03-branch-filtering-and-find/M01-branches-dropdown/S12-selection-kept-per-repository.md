# E03-M01-S12 · The selection kept per repository

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S12 selection kept per repository

A repository opens on the branch selection and the Show Remote Branches choice last applied to it, in the control
and in the graph, from the first page drawn. What was applied is kept across a restart and between instances of the
application open at the same time on one user-data directory, each repository its own. A kept branch the
repository no longer has is dropped, and a repository whose kept branches are all gone opens on Show All.

This is the owner's ruling of 2026-10-28, recorded in `MILESTONE.md` and `docs/PLAN.md`. Git Graph 1.30.0, as
observed on 2026-10-25 and recorded in E03-M01-S10's task, kept the unchecked Show Remote Branches when its view was
closed and reopened, and reopened on Show All; keeping the branch selection too departs from it on purpose. Every
other point of the control is as `S10-branches-dropdown.md` describes it.

## What a person sees

- **Opening a repository** shows the selection and the checkbox last applied to it. A repository with nothing kept
  opens as before: Show All, remote branches shown.
- **What counts as applied** is every selection the control asks the graph for: a click on a branch, a click or
  double-click on Show All, the checkbox, and the dropping of remote branches the checkbox causes. A press that asks
  for no new page keeps nothing new, because it changes nothing: a double-click that checks every entry asks for
  every branch, which is what Show All alone asks for, so the repository reopens on Show All alone.
- **Refresh and Load More** keep the selection, as before.
- **Each repository keeps its own**: applying a selection in one never changes what another opens on.
- **A second instance** on the same user-data directory opens a repository on what the first applied to it, if the
  first applied it before the second opens it. An instance does not pick up a change made in another to the
  repository it already shows; it shows it the next time it opens that repository.
- **A kept branch the repository no longer has** — deleted, renamed, or a remote branch whose remote is gone — is not
  checked when the repository opens, and the others are. When none is left, the repository opens on Show All, with
  the checkbox as it was kept. The control never shows a branch checked that its list does not hold.
- **A kept record that is not one this application wrote** opens the repository as if nothing were kept, and nothing
  on the page fails.

Before the first page of a repository arrives, the window shows what it showed before, and the disabled checkbox its
default, checked. The kept choice is given to the control in the same task as the first page is handed to the table,
and no page under another selection is drawn before it (below).
*Corrected by E04-M01-S04, 2026-11-04:* since E04-M01-S03 the disabled checkbox is indeterminate before the first
page, not checked (`remotes.indeterminate = true` in `buildParts`, `src/ui/branch-control.ts`), and `open` in
`src/ui/renderer.ts` clears that in the same task that sets what the open's reply says is kept. Read from that code and
from E04-M01-S03's slice document, which records the state seen in the running application; not measured again by
E04-M01-S04.

## What is kept, where, and in what form

**By the main process, in files under the application's user-data directory**, as `src/app/theme.ts` keeps the
theme (`src/app/selections.ts`). Not in the renderer's own storage, which is where E03-M01-S10 kept the checkbox:
a second instance on the same user-data directory finds the browser profile held by the first and cannot read that
storage at all, and its first `localStorage` call blocked its page for seconds (S10's measurement). A file is read by
whichever process opens it.

- **The folder** is `branch-selections` in the user-data directory, created by the first write.
- **One file per repository**, named by the SHA-256 of the path the repository was opened by, in hexadecimal. Two
  instances writing two repositories therefore never write the same file. The hash, rather than the path itself,
  keeps the name one fixed length whatever the path's characters and length.
- **The file holds the selection as JSON**, its two fields and nothing else:
  `{"branches":["refs/heads/feature","refs/heads/topic"],"showRemoteBranches":false}`, or `"branches":null` for
  every branch. That is `BranchSelection` exactly as the graph is asked for it, so nothing translates between what is
  kept and what is read.
- **A write never leaves a half-written record.** It writes a file of its own beside the record — the record's name,
  a dot and this process's id, so two instances never share one — and renames it over the record. The line that
  hinges on is `renameSync(from, to);` in `replace` of `src/app/selections.ts`: until it runs a reader finds the
  previous record, and after it the new one, whole. Writes from one instance are chained, so they reach the disk in
  the order they were applied, and the record ends holding the last. Two instances writing the same repository: the
  last write wins.
- **A refused rename is tried again**, ten times twenty milliseconds apart. Windows refuses a rename over a file
  another process holds open, and an instance reading the record holds it open while it reads. Measured by this lane
  on 2026-10-28 with two Node processes on this machine, one renaming a fresh file over a record and the other
  reading that record, both without pause, for five seconds: 51 of 98 renames were refused with `EPERM`, and none of
  210 reads failed or read half a record. With the retry, through the store itself against the same reader (3 328
  reads in five seconds), 1 of 83 writes was given up after its ten attempts. An instance reads a record once per
  open, so a reader that holds it that often is far beyond the case it guards.
- **The file calls are synchronous**, as `src/app/theme.ts` reads its file. The first asynchronous file call the main
  process makes costs it about 32 MiB of private memory for as long as it runs. `npm run gates:budgets` found it:
  the 50 000-commit private-memory verdict read 178.1 to 189.3 MiB in three readings at this slice's head with the
  record read through `fs/promises`, against 152.7 and 154.5 MiB in two at its base, the main process alone 65.7 to
  71.3 MiB against 39.8 and 41.9 (none of the five was taken on a free machine). Bisected by this lane on 2026-10-28
  on a three-commit repository, the main process's private bytes twenty seconds after the first page, three
  launches each: 67.6 to 71.6 MiB with the record read through `fs/promises`, and 35.7 to 38.6 MiB with it read by
  `readFileSync`, or not read at all as at the base. What the synchronous calls cost the window is under *What it
  costs* below.
- **A record is read at each open**, not once at start, which is what lets an instance open on what another applied
  while it was running. An instance's read waits for its own writes still in flight, so it reads what it applied
  last.
- **A selection is written once the utility process has answered it with a page**, and the reply waits for the
  write. So the page under a selection is drawn only once that selection is on the disk for the next open, and a
  selection overtaken by a later one, which the utility process drops (S09), is never kept.
- **A write that fails** is said on the main process's error stream, as a theme that cannot be kept is; the selection
  still holds in the window, and the next open does not find it.
  *Corrected by E04-M01-S04, 2026-11-04:* since E04-M01-S03 it is also said in the window, once a run, by a warning
  message box titled *Not kept* (`sayUnkept` in `src/app/window.ts`, called from the write's `catch` in
  `src/app/selections.ts`), and so is a theme that cannot be kept; the error stream line stays. Read from that code and
  from E04-M01-S03's slice document; not measured again by E04-M01-S04.

The selection is written for **the repository opened last**: the main process records the path of every open the
utility process answered with a page. The utility process answers a selection with a page only while the repository
it was applied to is still the one open, so a selection applied while another repository is being opened is dropped
there and never written under the wrong path.

A record kept in the renderer's IndexedDB by E03-M01-S10 is not migrated: no release ever carried it.

## The contract change, and why it is this one

The renderer has to know, with the first page, which selection that page was read under, so that it gives the
control that selection in the same task as it draws the page. So **the open reply gained one field**:
`OpenRepositoryResponse` is now `Result<OpenedPage>`, and `OpenedPage` is `GraphPage` with `selection`, the selection
the page was read under.

- **The main process chooses the selection**, because it is the process that keeps it: the renderer asks to open a
  path and nothing more, and could not have read the record itself without a new channel.
- **A field on the reply is required whichever side chooses**: with the main process choosing, the renderer still
  learns the choice only from the reply. A new channel or bridge method, such as one answering the kept selection
  for a path before the open, would cost a second round trip before every open and a method on the bridge, and buys
  nothing the field does not.
- **The request keeps its optional `showRemoteBranches`**, with a meaning that now differs from absence: present, the
  repository opens on every branch with remote branches shown or not as it says, and what is kept is neither read
  nor changed by the open. `test/e2e/branch-selection.spec.ts`, outside this slice, opens a repository through the
  bridge with `showRemoteBranches: false` and requires remote branches hidden; dropping the field would have broken
  that spec's types and its case. The renderer no longer sends it.

No channel and no bridge method was added; the preload did not change. `test/contract/shapes.snapshot.txt` gained
`OpenedPage`, the changed `OpenRepositoryResponse` and the four new functions below, and lost nothing.

## Where each rule lives

`docs/ADR-0002-architecture-and-performance.md` decision 1 keeps every decision out of `src/app/` and `src/ui/`. The
rules are in `src/contracts/kept-selection.ts`, with `menuOf` in `src/contracts/branch-menu.ts`, the ring both
processes may import and the one the mutation gate covers; their tests, `src/contracts/kept-selection.test.ts`,
cover both modules at 100 % of statements, branches, functions and lines.

| rule | function | called by | the line it hinges on |
| --- | --- | --- | --- |
| whether a stored value is a selection | `keptSelection` | main, on each read and before each write | `!Array.isArray(branches) \|\| !branches.every(isFullName) \|\| new Set(branches).size !== branches.length` |
| which selection an open reads under | `openingSelection` | main, at each open | `return kept ?? { branches: null, showRemoteBranches: true };` |
| which kept branches the repository still has | `survivingSelection` | renderer, at each open | `const branches = selection.branches.filter((name) => offered.has(name));` |
| what the control shows for a selection | `menuOf` | renderer, at each open | `selection.branches === null ? SHOW_ALL : …` |

- **`keptSelection`** answers the selection a value holds, or `null` when it is anything but an object whose
  `showRemoteBranches` is a boolean and whose `branches` is `null` or a list of distinct names beginning
  `refs/heads/` or `refs/remotes/`. It answers a new object holding those two fields alone. It checks what is read
  from the disk and what arrives from the page before it is written; neither is trusted. JSON that does not parse
  is caught by the store, as a missing or unreadable file is.
- **`openingSelection`** answers what is kept, or every branch with remote branches shown when nothing is; and every
  branch as the request says when the request says whether remote branches are shown.
- **`survivingSelection`** drops from a selection every name that `branchEntries` — the very list the control shows —
  does not offer for the page's references, and answers every branch when none is left, keeping the checkbox as it
  was. So a deleted or renamed branch goes, a remote branch whose remote is gone goes, and a remote branch kept while
  remote branches are hidden goes. A selection of every branch is answered unchanged, and nothing is listed for it.
- **`menuOf`** is Show All alone for every branch, and otherwise the selected branches checked.

**Why the renderer drops the gone branches, and not the main process.** Which branches a repository still has is
read from the page's references, and the renderer already reads them for its list. Done in the main process, the
same rule pulled the references' decoders and the list into `main.cjs`, which measured 8 130 production bytes that
way against 6 506 with the rule in the renderer, before the rename retry above (`npm run gates:size`, 2026-10-28);
and it would have run, in the process that owns the window, a sort of every branch name at every open, which the
renderer runs anyway.

**What the renderer does with a gone branch.** `open` in `src/ui/renderer.ts` asks `survivingSelection` of the
reply's selection and references. When the answer differs from the reply's selection, the page read under the kept
one is not drawn: the renderer applies what survives with a Refresh, as a click would, and that reply is the first
page drawn — every branch, when nothing survives, so a stale record never shows an empty graph. The line that
hinges on is `if (!sameSelection(shown, selection))` there.

**Whether what survives is written back at once.** It is: applying it is a Refresh with a selection, which the main
process keeps like any other. The reasons:

- **The utility process must read only branches the control shows.** A page read under the kept list is the same
  page — git skips a name it does not resolve (S09) — but the utility process would go on reading under that list,
  and a branch of the same name created later would reappear in the graph on the next Refresh while unchecked in the
  control. Applying what survives replaces that list there, and that takes a read, a second first page.
- **Written back, a gone branch costs that second read at one open only.** Kept as it was, every later open of the
  repository would pay it, for as long as nobody changed the selection.
- **What it costs.** An open after a kept branch went writes the record. If another instance applies a choice to the
  same repository during that open's two reads, the later write wins, and it may be this one. It needs a branch gone
  and two instances choosing for one repository within a page read of each other.

## Two instances

Each instance's main process reads a repository's record when that repository is opened, and writes it when a
selection is applied, through the rename above. So an instance opens a repository on what any instance applied to
it last, and two instances writing two repositories never touch each other's file. An instance does not watch the
files: it does not pick up a change made in another to the repository it already shows. Nothing of the renderer is
kept, so a second instance is no longer held up by the first one's browser profile.

Measured by this lane on 2026-10-28 with the built application, a second instance launched on the user-data
directory of a running first: from its launch to its first page drawn and its control usable, 1 541 ms (on the
`remotes` fixture, 5 000 commits) and 1 427 ms (on the `tags` fixture, 3 commits) in two runs of the spec below, and
2 262 ms in a third launch by hand. E03-M01-S10 measured 7 505 to 9 709 ms for the same with the checkbox in
`localStorage`, and 1 295 to 2 240 ms with it in IndexedDB. The processor load was not sampled during these three
readings, so they are readings and not a budget.

Watched by this lane on 2026-10-28, outside the spec, through a throwaway script that drove two built instances on
one fresh user-data directory and photographed both windows, the photographs then looked at: the first on the
`remotes` fixture, the second on the `tags` fixture; in the first, Show Remote Branches unchecked and `release`
checked; then, in the second, Open Repository answered with the `remotes` fixture. The second showed `release` in
the box, the checkbox unchecked, and the graph of `release` alone, its first row `release`'s commit 4970, as the
first did.

## A repository by another path

"Repository" is the path it was opened by, as E03-M01-S10 keyed the checkbox, and the path is hashed as it is
spelled. Read from the code, not measured:

- **A repository that moves** is a new path: it opens on Show All with remote branches shown, and the record of the
  old path stays behind — 43 or 44 bytes when it holds every branch, more for each branch it names — which nobody
  reads and nothing removes.
- **One repository opened once from its root and once from a folder inside it** has two records, one per path, and
  each opening shows what was applied through that path. So does a path spelled two ways, such as with a drive
  letter in another case on Windows: nothing normalises it.

## Stale and malformed records

- **A stale record** — naming a branch the repository no longer has — opens as above, with what survives, and is
  replaced by what survives at that open.
- **A malformed record** — missing, unreadable, not JSON, a field of the wrong type, a list that names a branch twice
  or a name not in the full-reference form — is nothing kept: the store answers `null`, the open reads every branch
  with remote branches shown, and the record is replaced the next time a selection is applied. A record holding an
  empty list is read as a selection, and opens on Show All because none of its branches is left.

## What the spec holds

`test/e2e/selection-kept.spec.ts`, in the `application` project, five cases against the built application, each
on user-data directories of its own and launching on them more than once, every choice applied by clicks on the
control and read back from the control (the box's text, the checkbox, the rows the open list holds and holds
checked) and from the graph's top rows compared with `git log` of the same revisions:

1. **A restart.** Show Remote Branches unchecked and `feature` and `topic` checked, the application closed and
   relaunched on the same user-data directory: both restored. And every page the window drew from its launch —
   recorded by a script that runs in the page before the renderer, after every change to the document, and that
   says whether it ran first — is the kept selection's: none has the uncommitted row first, which every branch would
   have, and none holds a commit outside the kept branches' history.
2. **Two repositories.** `feature` checked in the `remotes` fixture; the `tags` fixture on the same directory opens
   on Show All with remote branches shown, and has the checkbox unchecked there; each then reopens on its own.
3. **Two instances at once.** A second instance runs from before the choice, on the `tags` fixture; the first
   applies Show Remote Branches unchecked and `topic`; the second then opens the `remotes` fixture through Open
   Repository, its folder chooser answered in its main process, and shows `topic` with the checkbox unchecked; the
   second then applies Show All, and the first still shows `topic`. The second's time to its first page is written
   to the run's output.
4. **Branches deleted with git**, in a copy of the fixture of the case's own: `feature` and `topic` kept, `topic`
   deleted, the relaunch shows `feature` alone with `topic` gone from the list; then `origin/only-remote` added,
   `feature` deleted and every branch of `origin` removed, and the relaunch shows Show All and the whole graph.
5. **Malformed records**: the record replaced by JSON that does not parse, by a short branch name, and by a string
   where the boolean belongs; each relaunch shows Show All with remote branches shown.

The case of `test/e2e/branches-dropdown.spec.ts` that held a restart keeping Show Remote Branches with the selection
back at Show All now holds the restart keeping both.

Watched failing, by this lane on 2026-10-28, against the built application each time:

- **With the source at this slice's base**, all five cases and the changed case of `branches-dropdown.spec.ts` fail;
  the reworked case 3 was watched failing at the base again after it was reworked.
- **With the main process's write of an applied selection taken out**, all six fail.
- **With the renderer's call of `survivingSelection` taken out**, case 4 alone fails, as predicted: the box read
  `feature & topic`.
- **With a page under every branch drawn before the kept one**, applied by a Refresh with a round trip between the
  two, case 1 fails on the recorded pages, as predicted; case 3 failed too, not predicted, because that first page
  enables the control before the open has finished and the open then overwrote the checkbox the case had just
  unchecked. A first attempt drew both pages in one task and case 1 passed: the table draws once a frame, so only the
  second page was ever drawn, and that attempt planted nothing the case could see.
- **With the store answering only records older than its own start**, as a store read once at start would, case 3
  alone fails, as predicted.
- **With the store not checking what it reads**, case 5 alone fails, as predicted.

The rules themselves are held by their unit tests and by the mutation gate, whose scope covers `src/contracts/`.

## What it costs, and what it leaves

- **Time, in the process that owns the window.** An open reads one small file before it asks for the page, and an
  applied selection's page waits for one small write, both synchronous. Measured by this lane on 2026-10-28 with a
  script that bundled `src/app/selections.ts` as it now is and ran it against a fresh directory: a read of a record,
  or of one that is not there, took 0.05 to 0.77 ms over fifty of each, the median 0.07 to 0.10; a read just after
  the record was renamed into place took 7.98 to 20.74 ms over fifty, the median 10.87 (a scanner reading the new
  file is an inference, not a measurement); a whole write took 1.11 to 2.02 ms over fifty, the median 1.48. The
  processor load was not sampled. An open reads right after a write only when a repository is reopened at once
  after a selection was applied to it.
- **A gone branch costs one open a second read**, as argued above.
- **Size.** `main.cjs` measured 6 661 production bytes against 5 106 at this slice's base (`npm run gates:size`,
  2026-10-28), of which, by the build's own attribution, `src/app/selections.ts` 776, `src/contracts/kept-selection.ts`
  420 and the two prefixes of `src/contracts/branch-menu.ts` 38; the rest is the wiring. Under the orchestrator's
  ruling in this slice's task its budget was reset once, to 8 192, and the total by the same 3 072 bytes, to 64 512
  (`comment-e03-m01-s12` in `scripts/gates/size-budget.json`). `renderer.js` went from 18 951 to 18 568 bytes and
  `repository.cjs` from 28 667 to 28 614; neither budget moved.
- **The bridge spec leaves a record behind.** `test/e2e/branch-selection.spec.ts`, outside this slice, launches on
  the application's default user-data directory and applies selections through the bridge, so a run of it now writes
  a record for the `remotes` fixture's path there. Read from that spec: each of its cases applies a selection, or
  opens with `showRemoteBranches`, before it asserts anything, so the record its last run left does not change what
  it holds; it passed in this lane's run of the whole end-to-end gate.
  *Corrected by E04-M01-S04, 2026-11-04:* that spec now launches on a user-data directory of its own, made and
  removed around each launch by `withOwnProfile` in `test/e2e/support/fixtures.ts`, so a run of it leaves no record in
  the default profile; how that was measured is in E04-M01-S04's slice document.
- **A write given up.** A rename still refused after its ten attempts, as above, leaves the previous record whole
  and is said on the error stream; the selection holds in the window, and the next open does not find it.
  *Corrected by E04-M01-S04, 2026-11-04:* since E04-M01-S03 the write given up is also said in the window, once a run,
  by the *Not kept* message box of the correction above; the error stream line stays.
