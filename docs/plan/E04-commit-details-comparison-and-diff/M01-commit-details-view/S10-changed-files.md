# E04-M01-S10 · The changed files

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S10 the changed files

The files pane of the details area, which S09 left as one line of plain text a file, shows the changed files as a tree
or as a list, chosen per repository, with each file's status, its line counts, two icons on hover and a context menu
holding the actions on a file. The pane draws only the rows inside its own height, so its cost does not grow with the
number of files a commit changed. The actions are done by the main process (the clipboard, the file manager) with
what the utility process reads from git (the repository's top level, where the working tree has the file now).

Each statement below is marked **measured** (a reading, with its method), **read from code** (a claim about files as
they stand, checkable by reading them) or **inferred** (a judgement no measurement made). Where an item of the task
says *the orchestrator's choice*, it was not read from the reference and the owner may overrule it.

## What it is made of

| piece | where |
| --- | --- |
| the rows of the pane and every rule behind them: order, compaction, collapse, a file's colour class, counts, letter, tooltip, actions | `src/contracts/file-tree.ts` (`fileRowsOf`) |
| the check of an action's request, and the join of a path to the top level | `src/contracts/file-action.ts` (`fileActionRequestOf`, `absolutePathIn`, `liesInside`, `isRelativeFilePath`) |
| the rule that follows a rename since a commit | `src/core/parse/current-path.ts` (`currentPathOf`) |
| the repository's top level and where a file is now: the port method, the git read, the question between the processes | `RepositoryReader.readFilePlace` (`src/ports/repository-reader.ts`), `src/adapters/git-file-place.ts`, `topLevelArguments` of `src/adapters/git-commands.ts`, the `file-place` question of `src/app/repository-protocol.ts`, answered by `filePlace` of `src/app/repository-host.ts` |
| the action itself: the clipboard and the file manager | `fileAction` of `src/app/handlers.ts`, the channel `CHANNELS.fileAction`, the bridge method `fileAction` |
| the pane: the pool, the scroll, the events, the options | `src/ui/file-pane.ts` |
| one pool row, and the icons | `src/ui/file-row.ts` |
| the one menu element, the options' two values | `src/ui/file-menu.ts` |
| the area, which now builds the pane and the controls column | `src/ui/details-area.ts` |

**What the renderer exposes** (for S12): `GraphTableView.setRepository(path)`, `onFileAction(listener)` and
`addFileOptions(group)`. **How S12's options join the options control:** an `OptionGroup`
(`{ title, choices: { label, selected(), choose() }[] }`, `src/ui/file-menu.ts`) passed to `addFileOptions`. The options
menu is rewritten at each opening from the built-in groups and the added ones, a heading and then one line a value with
the chosen one marked, so an added group appears with no change to the menu. A group's `choose` is called after the menu
closes and is S12's to make take effect.

## The rules (scope A)

- **Order** (read from code; item 5 is a reading of one case and the comparison is the orchestrator's choice). At every
  level folders come before files; each group is by name, compared lower-cased (`toLowerCase`) and then as written, in
  UTF-16 code units. The list is the tree's order flattened with every folder expanded, so folders still come before
  the root's files in it. Held by unit tests that compare whole outputs with literals, including the 2026-10-25
  commit's shape and the root commit's list order; names that differ only in case; a file and a folder of one name.
- **Compaction** (item 3). A folder whose only child is one folder is one row with it, repeatedly, labelled by the names
  joined by ` / `. A folder holding a folder and a file is not compacted. A compacted row collapses as one, recorded by
  the path of its deepest folder (`FolderRow.key`), so toggling compaction cannot leave a stale record: every change of
  view or option and every reply expands every folder again (the orchestrator's choice).
- **What a file row carries.** Colour class: added, untracked and copied as `added`; deleted as `deleted`; modified,
  renamed and type-changed as `plain` (a copy and a change of type: the orchestrator's choice). Counts: `(+n | -n)`
  for every status but added, deleted and untracked, and only when both counts are numbers (the 2026-11-11 spacing:
  the orchestrator's choice between two readings). Letter: `A M D R U` when the letters are on, before the name; a
  copy takes `A` and a change of type `M` (the orchestrator's choice). Tooltip: the full path, then the status spelt
  out, a rename or a copy with its old path. Actions: *Open File* for every file but a deleted one, and both copies
  for every file.
- **The rows are computed once** per reply, per collapse or expand and per change of view or option (read from code:
  `rebuild` in `src/ui/file-pane.ts` is the only caller of `fileRowsOf`, and the scroll handler only schedules a frame).

## The pane (scope B)

- **One pool, drawn on scroll.** The pane holds `ceil(height / 22) + 2 × 4` row elements, rebuilt only when its
  height changes, each moved by `translateY` and rewritten in place. The pane's height is 249 pixels, so the pool is
  20 elements (**measured**: 20 `.files__row` elements in the document with 50 000 files, below). The row is 22
  pixels, one line, and a longer name is clipped with an ellipsis and read whole in the tooltip (the orchestrator's
  choice). The overscan is the table's own, 4 rows (`OVERSCAN_ROWS` of `src/ui/geometry.ts`), which that module
  argues: a scroll of up to four rows in one frame reveals nothing blank. It costs 8 elements, and changing it is a
  change to `FILE_OVERSCAN` and to the literal in `changed-files-cost.spec.ts`. **The line where the pane decides
  which rows exist as elements** is the `size` of `paint` in `src/ui/file-pane.ts`.
- **Folders collapse by a click on the row; a click on a file does nothing** (item 13 is E04-M02's), and a click inside
  the area closes nothing (S09's rule, unchanged).
- **The view is kept per repository, for the run of the application** (the orchestrator's choice). A repository on which
  a view button was pressed shows that view, any other shows `Default File View`. The key is the path the repository was
  opened by (`session.path`), set by `renderer.ts` when an open succeeds. Opening another commit, the uncommitted
  changes or a stash keeps the view.
- **Failures** of an action are shown in one line at the top of the pane until the next action or reply, not in the
  window's failure bar (the orchestrator's choice, as S09 chose for a failed read). A success shows nothing.
- **The menu** is one element, built with the view and rewritten at each opening, placed with `position: fixed` and
  kept inside the window. It closes on a choice, on a click anywhere else, on any scroll, when the area closes and when
  the window loses focus (**measured** by one assertion each). Escape is S11's.
- **Open File runs nothing.** It shows the file selected in the system's file manager
  (`shell.showItemInFolder`), because the system's default program for a script or an executable in someone else's
  repository would run it. This is the orchestrator's choice and **the owner's to overrule** (task, *Gaps*, item 1).

## The actions (scope C)

- **The request is checked once, in the main process, before anything of it reaches git, the file system or the
  clipboard:** `fileActionRequestOf` accepts one of the three actions, a target `detailsTargetOf` accepts, and a path
  that is non-empty, `/`-separated, relative, with no empty, `.` or `..` segment, no backslash and no NUL. Where the
  path is joined to the top level, `absolutePathIn` checks that the joined path lies inside it, once its `.` and `..`
  are applied, against the top level as written (so a top level that itself holds a `..` is refused). The utility
  process checks the target again, because it reaches a command line.
- **Following renames.** For a commit or a stash the main process asks for `git diff <hash> --raw --numstat -z -M`
  with the details read's overrides (`uncommittedDiffArgs`), parsed by the existing changed-files parser, and
  `currentPathOf` takes the rule: a `renamed` entry whose old path is the file's gives the new path, a `deleted` entry
  of the path means the file is gone, anything else leaves the path. For the uncommitted changes the path is the
  working tree's already, and no diff is read. **A limit, read from code:** the diff compares the commit with the
  working tree's *tracked* files, so a rename the working tree holds only as a deletion and an untracked file is not
  followed and ends in *`path` is not in the working tree.*
- **A path that is not UTF-8** arrives with U+FFFD (S06). The rename rule compares paths read from git with the same
  decoder, and `Open File` checks the file on disk at the joined path, which fails for such a name. The copies write
  the reply's path as it is.
- **A failure kind.** The message *is not in the working tree* and the refusal of a request are `FailureKind.GitFailed`:
  the frozen contract has no kind for a file, and adding one is the owner's (the same answer `repository-host.ts`
  gives for a defect of the application).
- **The git processes** are counted from git's own trace. **Measured** (adapter case, `git-file-place.spec.ts`, and
  end-to-end case, `file-actions.spec.ts`): none for a relative copy and for a refused request; one (`rev-parse`) for an
  absolute copy and for opening an uncommitted file; two (`rev-parse`, `diff`) for opening a commit's file. A design
  that started fewer would have to read the top level once per repository, which needs a record of the open
  repository's top level in the utility process: not built, because the open path is budgeted not to read one
  (`budgets-git.spec.ts`).
- **No top level is read on open** (**measured**: `budgets-git.spec.ts` is unchanged and its counts hold).

## What the pane costs (scope B12)

All of this section is **measured** by `test/e2e/changed-files-cost.spec.ts` on the built application, on 2026-11-12,
with replies fed to a second view of the page the way `details-panel.spec.ts` feeds one, for 1 000, 10 000 and 50 000
files, nested (`dN/sM/fK.txt`, 50 by 20 folders) and flat.

- **Live row elements:** 20 at every count and every scroll position tried (offset 0, 5 rows, half way and the end),
  against a bound of 20 computed from the pane's height. At the end of the range the last row sits at the end of the
  spacer.
- **A burst of 25 scroll events costs one frame**, and an idle window with the pane full schedules none (**measured**:
  the number of `requestAnimationFrame` calls registered and run, counted by wrapping it).
- **The time from handing the reply to the pane drawn** (the reply handed, then two frames), five readings each, are
  recorded in *Evidence* with the load sampled during them.
- **A defect this section found and the fix.** The first run of this case measured 1.3 s for 10 000 files and 6 s for
  50 000, and 50 008 row elements: the pane's root was not a flex container of fixed height, so the pool was sized by
  the 1.1 million pixels of the spacer. The fix is in `renderer.css` (`.files` is a column of the area's height, the
  area's grid row is `minmax(0, 1fr)`). The rows themselves cost 50 to 80 ms for 50 000 files (**measured** in a
  Node process, nested, five runs: 79, 55, 51, 50, 50 ms) and the cost of one reply is now below that plus two frames.

## A change to S09's close, and why

Closing the area now draws the table at once and cancels the pending frame (`flush` of `src/ui/graph-table.ts`, called by
`closeDetails`), where S09 only scheduled a frame. **Measured:** with S09's test *a label or the inside of the area
opens nothing…* (`details-panel.spec.ts`, unchanged) the full end-to-end gate went red at that case in two runs in a row
at this lane's head, and the case failed 4 of 16 runs alone at the head and 14 of 16 at the base commit, on a machine the
other projects were using; with the change it passed 16 of 16 alone and in the full run. **Read from code:** the case reads
the rows' tops the moment the area is hidden, and `placeArea` had hidden the pool until the next frame, so no frame ever
drew the gap (S09 argued that); the case read it anyway. The redraw count is the same, one: the pending frame is
cancelled, and the redraw tests of `graph-table.spec.ts` and `details-lines.spec.ts` pass unchanged. Opening is unchanged.

## What was seen, against items 1 to 12 of the reference (scope D1)

Looked at in the built application on 2026-11-12, in the light and the dark theme, on `details`, `stashes` and an
`ownFixture` repository whose working tree had `renamed.txt` moved with `git mv`. **Open File was not looked at in the
file manager:** the cases and the look replace `shell.showItemInFolder` in the main process, so that no window of
another program opens; what was measured is the path it is handed. That the file manager selects the file is for the
owner to confirm.

- *1, 2:* two icon buttons under the close control, tooltips *File Tree View* and *File List View*, the active one on a
  lighter background in both themes; a third, *Options*, under them. The pane starts as the tree. The listing's
  setting is the options menu's *Default File View*.
- *3, 4:* folder rows with a folder icon, shut or open, files indented under them with a file icon; `deep / er / still`
  is one row; a click on it collapses it. The list shows full paths.
- *5:* folders before files in both views.
- *6, 7:* added files green, the deleted file red, the rest in the ordinary colour; with the letters on, the letter
  sits before the name in the file's colour.
- *8:* a rename is one row under its new path; the old path is in its tooltip.
- *9:* `(+1 | -1)` after a modified or renamed file, green and red; no count on an added, a deleted or a binary file.
- *10:* accented and CJK names show as written; the U+F022 name of the reference's fixture is not in this project's.
- *11:* two icons at the right of a file's row while the pointer is over it: copy, and open (not on a deleted file).
- *12:* a right-click on a file opens a small menu at the pointer, *Open File*, *Copy Absolute File Path*,
  *Copy Relative File Path*; the menu stays inside the window.

Not seen: the reference's context menu (never observed), its behaviour across a restart, and a letter's position in the
reference.

## Measured, read from code, inferred

- **Measured:** the rows of every fixture above (end-to-end, each row compared with a literal read from `git`'s output
  on the fixtures); the pool, the burst and the idle window; the git process counts; that the replacements of the
  clipboard and the file manager are what the handler calls (the real clipboard's text read before and after is the
  same, and the replacement holds what the action produced); each probe of the audit, red then green.
- **Read from code:** the rows are computed once per reply; the one menu element; the pool's size formula; the
  per-repository key.
- **Inferred:** that Chromium writes a `transform` back with six significant digits when it is read (the cost case
  reads positions from the layout instead, after its first form read `-1` for rows past a million pixels); that
  layout itself is unaffected.

## Evidence: the wall-clock readings and the pane's timings

Every reading of `npm run gates:budgets` was taken by its own run of one case, judged on the minute before it and on the
reading itself, by the runner of S09's third session (`budgets-job.ps1`, copied to this lane's scratch folder and not
written in place; the case table is its `retry.ps1` with the cases of this lane's worktree and the cost case added).
Machine free: the processor load of everything outside the reading's own tree averaged under 40 % over the minute before
and during it, with no sample over 75 %. **The other projects' agents kept the machine busy**: the busiest process outside
the reading was `vmmemWSL` (a WSL virtual machine, not this project's) in nearly every attempt, at about half the
processors, so most attempts were discarded, and a reading that was discarded is recorded, not hidden.

| case | try | window | others, mean | others, max | samples over 75 % | busiest process outside the run | verdict | reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bench | 1 | 12:20:27-12:20:48 | 29.8 % | 92 % | 4 of 20 | claude x16, MsMpEng x3 | green | discarded |
| bench | 2 | 12:28:25-12:28:43 | 20.5 % | 51 % | 0 of 18 | claude x14, svchost x2 | green | kept |
| frames | 1 | 12:36:18-12:37:35 | 13.2 % | 49 % | 0 of 74 | claude x50, dwm x6 | green | kept |
| empty | 1 | 12:44:26-12:45:07 | 51.7 % | 80 % | 1 of 39 | vmmemWSL x36, MsMpEng x3 | green | discarded |
| empty | 2 | 12:52:53-12:53:25 | 61.2 % | 79 % | 2 of 31 | vmmemWSL x31 | green | discarded |
| empty | 3 | 12:54:29-12:55:05 | 60.7 % | 77 % | 1 of 34 | vmmemWSL x33, MsMpEng x1 | a case went red | discarded |
| empty | 4 | 12:56:20-12:56:50 | 50.7 % | 68 % | 0 of 28 | vmmemWSL x28 | green | discarded |
| empty | 5 | 12:59:38-13:00:08 | 53.8 % | 71 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| 13:00:43 empty try 6 never ran |
| empty | 7 | 13:03:17-13:03:50 | 62.7 % | 86 % | 4 of 31 | vmmemWSL x24, MsMpEng x7 | green | discarded |
| empty | 8 | 13:04:54-13:05:35 | 70.3 % | 87 % | 10 of 38 | vmmemWSL x35, MsMpEng x3 | a case went red | discarded |
| empty | 9 | 13:06:49-13:07:22 | 61.8 % | 84 % | 5 of 32 | vmmemWSL x28, MsMpEng x4 | green | discarded |
| git | 1 | 13:03:17-13:03:31 | 63.6 % | 81 % | 3 of 13 | vmmemWSL x10, MsMpEng x3 | green | kept |
| cost | 1 | 13:04:44-13:05:08 | 65.5 % | 95 % | 6 of 22 | vmmemWSL x20, MsMpEng x2 | green | kept |
| click | 1 | 13:06:48-13:07:01 | 65.0 % | 81 % | 4 of 12 | vmmemWSL x10, MsMpEng x2 | green | kept |
| first | 1 | 13:08:16-13:08:53 | 62.8 % | 80 % | 1 of 34 | vmmemWSL x31, MsMpEng x2 | a case went red | discarded |
| first | 2 | 13:10:27-13:10:58 | 48.5 % | 63 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 3 | 13:14:14-13:14:48 | 59.9 % | 79 % | 2 of 32 | vmmemWSL x31, MsMpEng x1 | green | discarded |
| first | 4 | 13:15:52-13:16:22 | 49.1 % | 64 % | 0 of 29 | vmmemWSL x27, MsMpEng x2 | green | discarded |
| first | 5 | 13:17:26-13:17:57 | 49.2 % | 64 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 6 | 13:19:01-13:19:32 | 49.6 % | 61 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 7 | 13:20:36-13:21:06 | 50.1 % | 65 % | 0 of 29 | vmmemWSL x28, MsMpEng x1 | green | discarded |
| first | 8 | 13:22:10-13:22:40 | 49.6 % | 64 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 9 | 13:23:44-13:24:15 | 49.8 % | 65 % | 0 of 29 | vmmemWSL x28, MsMpEng x1 | green | discarded |
| first | 10 | 13:25:19-13:25:49 | 50.2 % | 66 % | 0 of 29 | vmmemWSL x28, MsMpEng x1 | green | discarded |
| first | 11 | 13:26:53-13:27:24 | 49.9 % | 62 % | 0 of 29 | vmmemWSL x28, MsMpEng x1 | green | discarded |
| load | 1 | 13:29:00-13:29:26 | 37.0 % | 54 % | 0 of 25 | vmmemWSL x25 | green | kept |
| answer | 1 | 13:30:30-13:30:38 | 40.9 % | 52 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 2 | 13:31:42-13:31:49 | 44.4 % | 60 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 3 | 13:32:53-13:33:01 | 44.3 % | 61 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 4 | 13:34:05-13:34:13 | 40.4 % | 55 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 5 | 13:35:16-13:35:24 | 40.3 % | 52 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 6 | 13:36:28-13:36:36 | 42.7 % | 62 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 7 | 13:37:40-13:37:48 | 43.1 % | 63 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 8 | 13:38:51-13:38:59 | 41.7 % | 60 % | 0 of 7 | vmmemWSL x7 | green | discarded |
| answer | 9 | 13:40:03-13:40:11 | 39.4 % | 50 % | 0 of 7 | vmmemWSL x7 | green | kept |
| empty | 1 | 13:41:15-13:41:44 | 49.0 % | 64 % | 0 of 28 | vmmemWSL x26, MsMpEng x2 | green | discarded |
| empty | 2 | 13:42:48-13:43:18 | 50.7 % | 64 % | 0 of 28 | vmmemWSL x28 | green | discarded |
| empty | 3 | 13:44:22-13:44:51 | 50.9 % | 65 % | 0 of 28 | vmmemWSL x28 | green | discarded |
| empty | 4 | 13:45:55-13:46:26 | 55.7 % | 77 % | 1 of 29 | vmmemWSL x24, MsMpEng x5 | green | discarded |
| empty | 5 | 13:47:30-13:48:23 | 47.6 % | 73 % | 0 of 51 | vmmemWSL x50, MsMpEng x1 | green | discarded |
| empty | 6 | 13:49:28-13:49:56 | 50.1 % | 61 % | 0 of 27 | vmmemWSL x27 | green | discarded |
| cost | 1 | 13:51:37-13:51:58 | 37.4 % | 59 % | 0 of 20 | vmmemWSL x20 | green | kept |
| git | 1 | 13:53:03-13:53:14 | 37.7 % | 50 % | 0 of 11 | vmmemWSL x11 | green | kept |
| click | 1 | 13:54:18-13:54:30 | 41.9 % | 56 % | 0 of 11 | vmmemWSL x11 | green | kept |
| 13:54:30 series ended |
| first | 1 | 13:55:44-13:56:14 | 50.1 % | 64 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 2 | 13:57:18-13:57:48 | 49.7 % | 60 % | 0 of 29 | vmmemWSL x29 | green | discarded |
| first | 3 | 13:58:52-13:59:23 | 49.1 % | 64 % | 0 of 29 | vmmemWSL x26, MsMpEng x3 | green | discarded |
| first | 4 | 14:00:27-14:00:57 | 49.4 % | 65 % | 0 of 29 | vmmemWSL x28, MsMpEng x1 | green | discarded |

- **First session:** kept bench, frames, git, cost, click, load, answer. **Owed at the first session's deadline (2026-11-12, six hours from the start of the session):**
  empty, first, memory (the memory case never ran: it needs a free minute and then eight). Not one red was read on a free machine.
- **Two of my own runners overlapped** from about 13:03 to 13:08: the first series was still alive when I started the
  second (found from the process list and stopped). The rows of the first series from 13:03 (`empty`, tries 7 to 9) and the
  second series' `git`, `cost` and `click` at 13:03 to 13:07 and `first` try 1 are therefore not clean readings of the
  machine; `git`, `cost` and `click` were read again alone in the fourth series, at the end of the table, and those
  are the ones quoted here.

### Second session (2026-11-12): the readings that were owed

The start-empty, start-first-page and memory cases were read again by the same runner, extended to list, for each try, the
three processes outside the run's tree that used the most processor time, summed over the run (processes that started and
ended between two one-second samples are not counted; ids and start times key each process). Tries 1 to 8 of `empty` were
not free and one case went red in each, on a machine that was not free; they are discarded, not read as red.

| case | try | window | others, mean | others, max | samples over 75 % | three busiest outside the run, share of all processors | verdict | reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |



- **Kept now:** empty (try 9, others' mean 39.3 %, the narrowest margin of the series), first (try 1), memory (try 7). All three green. Not one red was read on a machine that was free.
- **What the cold-start load was** (measured, then read from the other side): during tries 1 to 8 of `empty` the busiest process
  outside the run was `vmmemWSL` at 22 to 24.2 % of all processors, then the antivirus engine (`MsMpEng`) at 8.5 to 11.3 %, then
  `svchost` or `System`. At 14:05 the Linux side of that virtual machine was read with `top`: a speech-transcription process
  (`whisper`, niced to 19) of another project's work held 172 % of one core, 2.0 GiB resident. Its `ni` share was 24.7 % of the
  machine's processors in that `top` sample. At 15:26, `empty` try 9 read no `vmmemWSL` among the three and a mean of 39.3 %; at
  15:27 `first` read 32.0 %; a `top` on the Linux side at about 15:38 showed no such process. That is a correlation of two
  observations, not an isolation: I did not stop the process and did not read the virtual machine's use between 14:05 and 15:38.
- **Is the antivirus part of it?** It is a part, and it is outside the tree, so it counts. `MsMpEng` held 8.5 to 11.3 % of all
  processors during every try of `empty` and `first` (and 1.6 % in the memory case, which launches the application once for
  seven minutes). Its share stayed at 9 to 10 % in tries 9 and `first` 1, the two that were kept, so it does not by itself
  take a start case over the 40 % bound on this machine; the discarded tries were discarded by the virtual machine's 22 to 24 %.
  Whether it scans this run's own launches was not tested (no exclusion was set: that is a system setting).
- **The memory case needs seven minutes with no sample over 75 %**: tries 1 to 6 had 2 to 18 samples over it at means of 16.5 to
  36.2 %; try 7 had none. No cause for the spikes was read.

- **The cold-start cases read the same load every time (first session).** In the 25 attempts of `empty` and `first` that were not
  overlapped, the load outside the run's own tree was 47.6 to 61.2 %, the busiest process `vmmemWSL` each time; `load` and
  `answer`, read in between, read 37 to 44 %. I did not establish whether the steady half of the processors in the
  start cases is the other project's virtual machine or a process of the case that the sampler counts outside its tree.
  It is unexplained, and the two cases are owed on that account as well as on the load.
- **The pane's timings,** from the reply handed to the pane drawn (two frames included, about 33 ms at 60 Hz), five readings each,
  `changed-files-cost.spec.ts` on the machine at a kept reading (others 37 % mean, none over 75 %), printed and held to
  no budget (`ADR-0002` decision 6 names none for the pane):
  - nested folders: 1 000 files 32, 20, 26, 24, 21 ms; 10 000 files 25, 24, 23, 23, 27 ms; 50 000 files 70, 76, 75, 70, 69 ms
  - flat: 1 000 files 31, 23, 22, 21, 18 ms; 10 000 files 26, 20, 21, 26, 22 ms; 50 000 files 36, 55, 30, 50, 37 ms
  - a burst of 25 scroll events: 1 frame registered and 1 run; both cases of the file passed in 5.6 s
- **S09's click timing,** printed and not held, at its kept run:
  details: HEAD 134, 103, 109, 126, 108 ms; uncommitted 223, 200, 197, 199, 201 ms
  large: HEAD 153, 111, 102, 112, 110 ms
- **Mutation gate** (read at `80195d8`, the last head under the mutated folders): 2390 mutants, 2352 killed, 36 timed out, 2
  survived, 0 without coverage; score 99.92; 38 of 2388 detections rest on a clock (1.6 %, cap 25 %); the survivors list has 2
  entries and the run has 2 survivors, both on the list and in `src/core/store/hash-index.ts`, none in this lane's modules.
  An earlier run at the head before the repairs found 13 survivors in `file-tree.ts` and `file-action.ts`; each
  of the three modules of this lane re-run alone reads 100.00 with no survivor.

## Not in this slice

A click on a file opening its diff, *View Diff*, *View File at this Revision*, *View Diff with Working File* and the eye
(E04-M02); the Code Review button and *Mark as Reviewed* (E04-M04); every key (S11); the area's size and place and
keeping any choice across a restart (S12); the settings UI and *Context Menu Actions Visibility* (E02-M03). A menu on a
folder row is not built.
