# E04-M01-S11 · Keyboard navigation

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S11 keyboard navigation

With a row's details open, Up and Down open the details of the row above or below, Ctrl+Up and Ctrl+Down open those of
the commit's child or parent on the same branch, Shift with them takes the other branch at a fork or a merge, Escape
closes the files menu or else the details, and the opened row is kept in view. While the files pane's menu is open, Up
and Down move its focus and Enter and Space choose. Which row a key goes to is one function in `src/contracts/`; the
window holds one `keydown` listener that calls it.

**No key was ever observed in the running extension.** Both observers (2026-10-25 and 2026-11-11) had a grant on VS
Code that refused every key press. Every item of the reference is the Marketplace page's wording, and what the page
does not say is the orchestrator's choice, written in the task and followed here. *Gaps for the orchestrator* of the
task lists the twelve of them.

Each statement below is marked **measured** (a reading, with its method), **read from code** (a claim about files as
they stand, checkable by reading them) or **inferred** (a judgement no measurement made).

## What it is made of

| piece | where |
| --- | --- |
| the rule: which layout row a move goes to, from a page, the open row and one of six moves | `src/contracts/row-moves.ts`: `rowAfterMove(page, row, move)`, the type `RowMove` (`'up'`, `'down'`, `'child'`, `'parent'`, `'other-child'`, `'other-parent'`) and `NO_MOVE` (`-1`), exported by `src/contracts/index.ts` |
| the one `keydown` listener, and the decision whether a key is its own | `src/ui/keys.ts`: `listenKeys`, registered by `listen` of `src/ui/graph-table.ts` |
| opening a row without toggling it | `openDetails` of `src/ui/details-panel.ts`; `toggleDetails` now calls it for the opening |
| the menu's focus step | `step` of `FileMenu` (`src/ui/file-menu.ts`), `FilePane.menuOpen` and `FilePane.stepMenu` (`src/ui/file-pane.ts`) |
| the focused entry's mark | `.files__menu-item:focus` in `src/ui/renderer.css` |

## The rule (scope A)

`r` is the open layout row. A row's **parents** are the parent entries of its commit; a parent that is `UNKNOWN_INDEX`
or past the page is not a row. The Uncommitted Changes row has one parent, HEAD's commit. A row's **children** are the
rows above it that have it as a parent; a child is a **first-parent child** when `r` is its first parent. Row 0 is the
uncommitted row when the tree is dirty, so a layout row is a commit index plus one (read from code: `commitOf`).

| move (key) | answers |
| --- | --- |
| `up` (Up) | `r - 1`; none at row 0 |
| `down` (Down) | `r + 1`; none at the last loaded row |
| `parent` (Ctrl+Down) | `r`'s first parent; none when that entry is not a loaded row (a second parent is never taken instead) |
| `child` (Ctrl+Up) | among `r`'s first-parent children, the one whose vertex is in `r`'s lane (`layout.laneIndex`), else the nearest above; with no first-parent child, the nearest child of any kind; none with no child |
| `other-parent` (Ctrl+Shift+Down) | at a merge, the **second** parent entry; none when it is not loaded; with one parent, the same as `parent` |
| `other-child` (Ctrl+Shift+Up) | the nearest child that is not the one `child` answers; with one child, the same as `child` |

Every one of these is **the orchestrator's choice** where the page is silent (the task, scope A4 to A6): the page does
not say what "the same branch" is, which child is taken with several, or which alternative Shift takes with more than
two. A third parent or child is reached by a click.

- **Nothing loads.** A parent past the page and Down at the last row answer none, and the window then does nothing: no
  Load More is pressed (**measured**: `keyboard-moves.spec.ts`, *Down on the last loaded row*, on `remotes` with more
  to load: the control still reads *Load More Commits* and is enabled, the spacer's height is unchanged, and the main
  process answered no `repository:load-more-commits` call, counted by wrapping the handler in the main process).
- **Every row moves alike.** Commit rows, stash rows and the Uncommitted Changes row follow the same definitions. A
  stash's one parent is its base (`S14-stash-rows.md`), so the base sees the stash as one of its children.
- **Cost** (read from code, and measured in *What a move costs*). Children are found by one walk over the rows above
  `r`, from the top down so that the last child met is the nearest, at most `r` rows a key press, never per frame, and
  no table of children is kept. The log is read in `--date-order`, so a child is always above its parent
  (`S14-stash-rows.md`), which is what lets the walk stop at `r`. The walk does not stop early: an early stop needs
  guards whose mutants no test can tell from the unguarded code (the mutation gate found two equivalent survivors in
  the first form of the walk, and the form that replaced it has none).
- **Held by unit tests** (`src/contracts/row-moves.test.ts`, 21 cases) that compare whole outputs with literals: for
  each page, the six answers from every row. The pages are written by hand: a linear history; a fork whose two
  children both name it first parent, one in its lane and one not; a fork whose children are both out of its lane; a
  fork of three children with the one in the lane farthest away; a fork with a merge nearer than the first-parent
  child; the tip of a merged branch; a merge of two parents and of three; a merge whose second, and whose first, parent
  is not loaded; a parent past the page; the uncommitted row above HEAD and above a HEAD that is not the newest
  commit; the uncommitted row with HEAD not loaded; a stash on its base; and the three cases where the answer is row 0,
  which the comparison `row >= 0` against `row > 0` cannot hide.
- **Mutation** (**measured**, `npx stryker run --mutate src/contracts/row-moves.ts`, 2026-11-12, this module alone):
  100.00, 92 mutants, none surviving. The first form of the module scored 89.03 with 17 survivors and the second
  98.08 with two, both equivalent mutants of a loop bound; the third is the one handed over. `npm run gates` is the
  reading that counts and is in the audit.

## The keys (scope B)

**The line that decides whether a key is the view's** is `ignored` of `src/ui/keys.ts`: a key whose default action an
inner control has already withheld (`event.defaultPrevented`), a key with Alt held, and a key whose target is an
`input`, a `select`, a `textarea` or editable (`isField`) are not handled, and then nothing is consumed or scheduled.
The theme control is a `select` and changes on ArrowUp; the Branches list keeps its focus on its options and closes on
Escape with the default withheld, which is why it must be both (**measured**: *the theme control and the Branches list
keep their arrows over an open area*, and the probes below).

- **Which keys.** `ArrowUp` and `ArrowDown`: alone (Up, Down), with Ctrl (Child, Parent) and with Ctrl and Shift
  (Other child, Other parent). Ctrl is `ctrlKey` or `metaKey` on every platform. Shift without Ctrl and any key with Alt
  are not handled. Escape without a modifier is handled.
- **When.** With no area open the arrows are left to the window (below). With an area open a handled arrow opens the row
  the rule answers, and withholds the key's default action whether or not the rule answers a row, so that an arrow at an
  edge does not scroll the open row away (**measured**: *with no area open no key is taken*, which also shows the
  withheld default with one open).
- **A move is an opening, never a close.** `openDetails` leaves the row that is open alone and otherwise does what a
  click on another row does: the band, the area under the row, the request and the stale-reply guard. The rule never
  answers the open row.
- **Where the row is kept in view.** `centreBlock`, called by `openDetails`, is the one place: the row and its area as
  one block, centred in the list below the sticky head, the browser clamping the offset at both ends of the range. It
  holds when the open row was scrolled out of the pool before the key (**measured**, *a key keeps the opened block
  centred*: to within one pixel after moves from the middle of a long page, after the open row was scrolled away, and
  at the end of the page the view stops at its end). **For S12:** when Auto Center gets its off value, `centreBlock` in
  `openDetails` is where a move must scroll by the smallest amount that shows the block instead.
- **One redraw a move** (**measured**, *a move is one redraw, twenty presses in a task are one, and unhandled keys
  schedule nothing*, on the large fixture): a move one, a click on another row one, twenty `keydown` events dispatched
  in one task one. A key that is not handled schedules nothing: after `Shift+ArrowUp`, `ArrowLeft`, `a` and
  `Control+ArrowLeft`, the page's frame requests, timers and redraws are as before and stay so for half a second.
  **`Alt+ArrowDown` is not in that list, because it does schedule frames, and the listener is not the cause:** Chromium
  scrolls the list by a page on it, as the window did at Base (**measured**, one reading, 606 px and ten frames).
- **Escape closes one thing a press**: the files menu when it is open, else the details when they are open, else
  nothing; with an area open and the Branches list open over it, the list closes and the area stays (**measured**,
  *Escape closes the menu, then the area, one thing a press, and the Branches list alone*). Closing the area is
  `closeDetails`: the view does not scroll back. The window has no dialog; the notice of S13 blocks nothing and Escape
  leaves it.
- **The menu by key** (the page names no key for a menu; this mirrors the Branches list). While the menu is open Up and
  Down move the focus between its entries, stopping at the first and the last (headings are not buttons, so they are
  skipped), Enter and Space choose the focused entry because it is a button, and no arrow moves the details. A menu
  opened by the pointer has no entry focused and the first Down focuses the first entry. The focused entry has a solid
  outline and the open-row background, in both colour schemes (**measured**: computed styles read with each scheme
  emulated, *the focused entry is marked in both themes*; looked at in the built window, below).
- **Repeated presses.** A held key repeats `keydown`, and every press that moves asks for that row's details. Nothing
  is debounced and nothing runs on a timer.

### What the window does with Up and Down and no area open

**Measured, unchanged from Base.** The same spec, `zz-noarea`, kept in the scratch folder and not committed, was run
at Base (`git archive` of 1443f31, built in the scratch folder) and at this head, on the 5 000-commit `remotes`
repository after a click on the list's head, which opens nothing: ArrowDown scrolled the list by 40 px a press (0 to 40,
40 to 80, 80 to 120), ArrowUp back by 40, and Ctrl+ArrowDown, Ctrl+Shift+ArrowDown, Shift+ArrowUp and Escape moved it
by 0, at both. At this head no keydown of the twelve (the eight keys and the modifier presses between) had its default
withheld. The reference's Up and Down scroll the view then (the 2026-11-04 reading), which `docs/PLAN.md` gives to
E01-M03.

## What a move costs (scope C)

**Measured, printed and not held** (`ADR-0002` decision 6 names no budget for a key). `keyboard-cost.spec.ts`, on the
`large` fixture loaded to 9 700 further commits, 2026-11-12, **on a loaded machine**: other projects' agents were
running, and the processor load sampled with `os.cpus()` over the case read 100 %. These are not wall-clock-gate
readings and are not discarded or kept by the rule of `AGENTS.md` §11, which governs the gate.

| reading | five readings, ms |
| --- | --- |
| the time from the key's dispatch to the area placed under its new row, layout read (before the reply): Ctrl+Up from the last row of ten thousand, the longest walk | 12.5, 7.2, 8.1, 7.0, 8.9 |
| the same for Down from the middle row | 4.4, 3.8, 3.6, 3.2, 3.0 |

**A held key** (**measured**, one run on the same machine): twenty `ArrowDown` presses, each in a task of its own through
a `MessageChannel`, as fast as the page takes them. The window asked for twenty reads; git started twenty processes
(counted by `GIT_TRACE2_EVENT`, one `start` event each, so one process a read); one reply was drawn, and it was the
last one, drawn 2 743 ms after the first press; the details it showed are those of the row reached by clicking that row.
No earlier reply was drawn after it. **Whether a burst should cancel or skip its earlier reads is a plan decision.**

## What was seen, against items 1 to 11 of the reference (scope D1)

The built application was run on `details`, `stashes` and `branch-and-merge`, and the keys of scope B pressed with the
files menu open and closed and with the Branches list open. Screenshots stay in the scratch folder.

1. Up and Down: the rows opened in turn, the Uncommitted Changes row first, each with the area under it and the rows
   below moved down.
2. Ctrl+Up and Ctrl+Down: on `branch-and-merge`, `commit 3` (lane 0) goes up to `move main on` (lane 0), the commit in
   its own lane (seen), and down again (seen); on `details`, the merge goes to `move main on`, its first parent (by
   the case, not by eye).
3. Ctrl+Shift: from `commit 3` on `branch-and-merge`, Ctrl+Shift+Up opened `add the feature`, the other child, in lane 1
   (seen); the merge's second parent on `details` is `add a file on the side`, and from a row with one parent Ctrl+Shift+Down
   opened the same row as Ctrl+Down (the first seen: `rename, delete, add and modify, by two people`, the parent of
   `remove the names Windows cannot check out`).
4. Escape: with the menu open the first press closed it and left the area; the second closed the area.
5. With no area open the arrows scroll the list, as at Base.
6. At the edges nothing changed and nothing loaded.
7. A stash row and the Uncommitted Changes row move like the others: Ctrl+Down from `stash@{0}` opens `move main on`.
8. Not built here: Ctrl+F, Ctrl+H, Ctrl+R, Ctrl+S, Enter in a dialog (E01-M03, E03-M02).
9. Rebinding: not built (E01-M03).
10. On these short lists the block sits at the top of the list, the offset clamped at 0 (seen); the centring is
    measured on the long page, by the case.
11. In the menu the first Down focused `Open File` with a visible outline (seen, light scheme); the later moves of the
    focus are the case's, not seen.

## Evidence: the three things a green build would not catch

- **A Child that takes the nearest child.** The line is `const child = [inLane, nearestFirst, nearest].find(isRow)`
  in `childrenOf` of `src/contracts/row-moves.ts`. With it replaced by `nearest`, the unit tests went red (6 failed of
  21) and so did the `branch-and-merge` case (`Control+ArrowUp` opened the feature branch's commit instead of
  `move main on`); restored, both are green.
- **A key handled where it should not be.** The line is `ignored` of `src/ui/keys.ts`. Each probe was planted, built,
  run, seen red and removed: the keys handled with no area open (`no key is taken...` red: ArrowDown, ArrowUp and
  Ctrl+ArrowDown had their defaults withheld); the form-control check removed (the theme control stayed on `system`
  after ArrowUp); the withheld-default check removed (both Branches-list cases red: Escape closed the area as well).
- **A move made as a close and an open.** With `closeDetails` called before `openDetails`, the cost case read two
  redraws for a move and twenty-one for twenty presses, against one and one, and went red.
- **The other two probes of scope B.** Escape closing the menu and the area in one press (the Escape case red: the open
  row was gone after the first press); the centring left out of the key path (the kept-in-view case red); the menu
  taking no arrow (the menu case red: no entry focused after Down).
- **Scope A's three:** Other parent taking the last parent (1 case red, the merge of three); Down at the last row
  answering a row past the page (11 red).

## Measured, read from code, inferred

- **Measured:** every sentence above marked so; the 21 unit cases; the mutation score; the end-to-end cases in
  `keyboard-moves.spec.ts` (6), `keyboard-escape-menu.spec.ts` (5) and `keyboard-cost.spec.ts` (3); the no-area readings
  at Base and at head; the probes.
- **Read from code:** which line decides a key; that nothing is debounced and no timer is used (`src/ui/keys.ts` has
  none); that `rowAfterMove` walks at most `r` rows; that nothing here calls Load More.
- **Inferred:** that a move's centring is what Auto Center does for a key (the reference's setting applies to every
  opening, and no key was observed); that `metaKey` works on macOS (not built or verified, E07-M02); that Alt+Arrow's
  scrolling is Chromium's page scroll (one reading of the effect, none of the cause).

## Not in this slice (as the task says)

Up and Down scrolling with no details open, Ctrl+H, Ctrl+R, Ctrl+S, Ctrl+Shift+S and rebinding (E01-M03); Ctrl+F
(E03-M02); Auto Center's off value and its control, the docked place, the area's height (S12); moving through the
changed files by key, folding a folder by key and opening a file's menu by key (a design of its own, since the pane is
virtualised; the plan decides whether it is planned); cancelling or skipping a held key's reads (the plan decides).
