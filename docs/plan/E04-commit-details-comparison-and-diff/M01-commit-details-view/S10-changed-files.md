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

## Not in this slice

A click on a file opening its diff, *View Diff*, *View File at this Revision*, *View Diff with Working File* and the eye
(E04-M02); the Code Review button and *Mark as Reviewed* (E04-M04); every key (S11); the area's size and place and
keeping any choice across a restart (S12); the settings UI and *Context Menu Actions Visibility* (E02-M03). A menu on a
folder row is not built.
