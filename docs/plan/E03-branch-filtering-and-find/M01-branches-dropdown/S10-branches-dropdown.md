# E03-M01-S10 · The Branches dropdown

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S10 the Branches dropdown

The bar now holds, after Refresh, a label **Branches:**, the Branches dropdown and a **Show Remote Branches**
checkbox, on one row, before the theme control. The dropdown narrows the graph to the branches a person checks;
the checkbox shows or hides remote-tracking branches. Both apply through the call E03-M01-S09 added, `refresh({
selection })`, and a repository opens through `openRepository({ path, showRemoteBranches })`, exactly as S09's
slice document names them.

The reference behaviour was observed in Git Graph 1.30.0 by an observer session on 2026-10-25 and recorded in this
slice's task. This lane did not observe the extension again. Its look (sizes, colours) was taken as a
description; the control uses this project's own styles.

## The control

**Closed**, the box reads **Show All**, or the checked branches in the list's order (not the order they were
clicked): `a`, `a & b`, `a, b & c`, cut short with an ellipsis when it does not fit, the whole text on hover. It
is as wide as its widest entry, up to 320 pixels, so it narrows when remote branches are hidden.

**Open**, the list hangs under the box, as wide as it, over the graph. Its first row is a filter field
("Filter branches…"), which scrolls away with the rows. Then one flat list: **Show All**, the checked-out branch,
the other local branches by name, the remote-tracking branches by name with their remote, `origin/HEAD` among them.
Tags and the stash are not listed. About nine and a half rows show and the rest scroll inside the list; a name too
long for a row is cut short and shown whole on hover; the row under the pointer is highlighted; a checked row has
a check mark. Reopened, the list is at its top with an empty filter.

**Pressing.** A click on a branch checks it, or unchecks it if it was checked, and Show All loses its check; the
list stays open. Unchecking the last one returns to Show All. A click on Show All clears the others. A
double-click on Show All toggles between every entry checked (Show All too, and the graph shows everything) and
Show All alone; from every entry checked, a click on one unchecks only that one. Each press that changes the page
asked for asks for it at once. A press anywhere outside the control closes the list; a press on a row never does.

**Show Remote Branches**, checked by default. Unchecking it takes the remote entries out of the list and the
remote branches out of the graph, drops a checked remote branch and keeps the local ones, and returns to Show All
when only remote ones were checked. Checking it again restores nothing that was dropped.

**What is kept.** The checked branches survive Refresh and Load More: the control asks nothing of them, and the
process that reads the repository keeps the selection it last applied (S09). Since E03-M01-S12 they also survive
opening the repository again, and the checkbox with them: both are kept per repository by the main process, across
a restart and between instances, as
`docs/plan/E03-branch-filtering-and-find/M01-branches-dropdown/S12-selection-kept-per-repository.md` describes. This
slice kept the checkbox alone, in the renderer (below), and opened every repository on Show All.

## Observed, and decided here

Every point above that the task's **Reference behaviour** records is observed. What the observation could not
reach, because it needed keys or typing, is this project's decision:

- **The filter** keeps the entries whose name contains the typed text, ignoring case. Show All always stays; an
  empty filter shows every entry.
- **The keyboard.** The box is reached by Tab and opened by Enter or Space, which put the focus in the filter.
  The down and up arrows move between the filter and the rows; Enter or Space presses the row with the focus, as a
  click does; Escape closes the list and gives the box the focus; Tab closes it and moves on from the box (to the
checkbox: seen once by this lane with a throwaway script, and held by no case of the spec). The box
  is a button named by the visible label and its own text ("Branches: Show All"), the list a multi-select
  listbox named "Branches", each row an option whose `aria-selected` says whether it is checked, the filter a text
  field named "Filter branches", the checkbox named by its label. A double-click has no keyboard form: Enter on
  Show All is one press.
- **The order.** The checked-out branch comes first among the local ones (the observation could not tell it from
  the name `main`; the task says take "current"). The rest are in code-unit order, the default order of
  JavaScript's `sort`, which puts `origin/HEAD` before `origin/feature`, where it was seen. Git lists references
  in code-point order (the byte order of their UTF-8 spelling), which differs from code-unit order only where
  two names first differ by a character above U+FFFF against one from U+E000 to U+FFFF: code-unit order puts
  the first ahead, git the second. Measured by E04-M01-S03 on 2026-11-03 with git 2.51.0 on Windows, through
  `for-each-ref` and `branch --list`, loose and packed, over thirteen names from U+005A to U+20000; that the
  two orders agree on every other pair follows from how UTF-16 spells such a character, and was not measured.
- **What the box says when every entry is checked**, which the observation did not record: Show All, since the
  graph shows everything.
- **A checked branch the list no longer offers**, such as one deleted since it was checked, is named in the box by
  its short name after the listed ones, and stays in the selection; git skips it (S09).
- **A press that does not change the page asked for asks for nothing.** A click on Show All when Show All alone is
  checked, and a double-click that only changes the check marks, send no request: `choose` in
  `src/ui/renderer.ts` returns before asking when `sameSelection` finds the two selections equal. That is read
  from the code; no case of the spec counts requests.
- **A selection's page is drawn from its first row**, as an opened repository's is: it is a first page laid out
  from nothing, and the offset the table had belongs to rows it may not hold.

## Where each rule lives

`docs/ADR-0002-architecture-and-performance.md` decision 1 keeps every decision out of `src/ui/`, and the
dependency rule lets `src/ui/` import `src/contracts/` and nothing else, so `src/core/` is out of the renderer's
reach. **The rules are in `src/contracts/branch-menu.ts`**, the one ring both inside the renderer's reach and
inside the mutation gate's scope, with colocated tests at 100 % coverage. It keeps the ring's other rule: it
imports only its siblings and keeps nothing between calls.

| rule | function | the line it hinges on |
| --- | --- | --- |
| which entries, in what order | `branchEntries` | `...entriesUnder(LOCAL_PREFIX, [...current, ...locals.sort()])` |
| a click on a branch | `toggleBranch` | `return branches.length === 0 ? SHOW_ALL : …` |
| a press of Show All, and the double-click | `pressShowAll` | `if (clicks === 2 && !menu.pressedFromEvery)` |
| hiding remote branches | `showingRemotes` | `menu.branches.filter((name) => !name.startsWith(REMOTE_PREFIX))` |
| what the closed box says | `boxText` | `entries.filter((entry) => isChecked(menu, entry.name))`, which is the list's order |
| which page is asked for | `selectionOf`, `sameSelection` | `branches: menu.showAll ? null : menu.branches` |
| the filter | `matchingEntries` | `entry.label.toLowerCase().includes(wanted)` |

**The double-click needs one fact the second press cannot see.** A double-click arrives as two clicks and the
first one already clears to Show All alone, so the second cannot tell whether every entry was checked before the
gesture. `pressShowAll` records it on the menu it answers (`pressedFromEvery`), and the second press (the event's
`detail` of 2) reads it: from every entry checked the gesture ends on Show All alone, from anything else on every
entry checked.

The remembered checkbox had two hinges, both removed by E03-M01-S12: the call of `storeRemotes` in the checkbox's
`change` handler of `src/ui/renderer.ts`, and the line of `readRemotes` in `src/ui/remotes-store.ts` that answered a
stored boolean, `done(typeof request.result === 'boolean' ? request.result : null)`.

What the renderer holds is state, not rules: `src/ui/branch-control.ts` builds the elements, keeps whether the list
is open, the filter's text and which row has the focus, and reports which row was pressed and how many times;
`src/ui/renderer.ts` keeps the menu, the entries and the checkbox's value, and turns each press into the module's
answer and that answer into a request; `src/ui/remotes-store.ts` read and wrote the remembered checkbox until
E03-M01-S12 moved what is kept to the main process.

The module's exports, all through `src/contracts/index.ts`: `branchEntries`, `sameEntries`, `matchingEntries`,
`isChecked`, `toggleBranch`, `pressShowAll`, `showingRemotes`, `selectionOf`, `sameSelection`, `boxText`,
`SHOW_ALL`, `SHOW_ALL_LABEL`, and the types `BranchEntry` and `BranchMenu`. No existing contract type, channel or
bridge method changed; `test/contract/shapes.snapshot.txt` gained those lines and lost none.

## Where the remotes choice was kept, until E03-M01-S12

E03-M01-S12 moved it, with the branch selection, to files kept by the main process, and removed what this section
describes. Until then it was kept in the renderer's own IndexedDB (`src/ui/remotes-store.ts`): a database
`git-graphical-standalone` with one store, `show-remote-branches`, keyed by the path the repository was opened by,
holding `true` or `false`. The checkbox wrote it when it changed. `open` in `src/ui/renderer.ts` read it before it
asked for the repository and passed it as `showRemoteBranches`, waiting **at most 250 ms** (`REMOTES_WAIT_MS`); an
answer that came later, saying "hidden" for the repository still open while the checkbox was still checked,
unchecked it then, as a click would. The database was in the browser profile in the application's user-data
directory, so the choice outlived closing the repository and a restart: the end-to-end case below unchecked it,
closed the application, and found it unchecked on the next launch on the same user-data directory.

**Why the renderer, and not the main process.** The task directs it, so that the main process does not grow:
`main.cjs` measured 5 106 production bytes of its 5 120 at this lane's head (`npm run gates:size`, 2026-10-27),
and `src/app/` is outside this lane. What that costs is the next point, and a file kept by the main process, as
the theme's is, would not pay it.

**Why IndexedDB, not `localStorage`, and why the wait is bounded.** The first version kept the choice in
`localStorage`. A second instance of the application launched on the same user-data directory as a running one
finds the profile held. Measured by this lane on 2026-10-28 in the built application, with a first instance
running: the second instance's first `localStorage` call blocked its page for 5 440 ms (3 ms with no first
instance), freezing the whole window, and the second instance showed its repository 7 505 to 9 709 ms after its
launch over four launches, where the code at this slice's base took 1 109 to 2 091 ms. IndexedDB under the same
condition answered with an error after 5 873 and 5 927 ms, and blocked nothing. So the store moved to IndexedDB, and
the open stopped waiting for it beyond a bound: a fresh window opening the store and reading one stored path took
20.6 to 47.9 ms over ten launches, and 250 ms is about five times the slowest. With it, a second instance beside a
first showed its repository in 1 295 to 2 240 ms over three launches.

What it cost, said rather than hidden:

- **A second instance on the same user-data directory could not read the choice.** It opened with remote branches
  shown and its checkbox checked, as measured in the three launches above, and what it stored was not kept.
- **A repository that moves is a new path.** It opened with remote branches shown, and the old path's entry stayed
  behind, a few bytes nobody reads. The same held for one repository opened by two paths, such as its root and a
  folder inside it: the renderer knew only the path it opened by.
- **A store that could not be opened or written** meant the choice was not remembered; it still held until the
  repository was closed.
- **The late answer** — a "hidden" arriving after 250 ms — was applied by code no case of the spec reached: no
  launch measured here took that long to read the store.

## A thousand branches

The list is built when it opens and dropped when it closes, and a press that only changes check marks rewrites
one attribute per row rather than the rows, so a closed list of any size costs the document nothing.

The end-to-end case builds, privately, a repository of two commits and 1 000 local branches (`main` on the second
commit and 999 on the root, one of them with an 87-character name) and measures inside the page, from the click to the frame after the result is
shown. Readings by this lane on 2026-10-27 at `eb7f23f`, before the remembered checkbox moved to IndexedDB (neither
the click that opens the list nor a selection reads it), three runs, with a sampler reading the processor load of
everything but this lane's own processes every two seconds:

| run | open the list (1 001 rows) | one selection applied and drawn | other load during the run |
| --- | --- | --- | --- |
| 1 | 48.6 ms | 724.8 ms | mean 56.0 %, highest 71.9 % |
| 2 | 45.4 ms | 741.1 ms | mean 67.0 %, highest 77.1 % |
| 3 | 54.4 ms | 1 334.7 ms | mean 67.6 %, highest 83.1 % |

The machine was not free by `AGENTS.md` §11's measure for any of them (the minute before them averaged 66.4 %);
these are readings, not a budget, and are recorded as taken.

**Where the selection's time goes**, measured once in the same repository by this lane on 2026-10-27 inside the
page: the click handler on a row, which runs the module's rules over the 1 000 entries and rewrites the check
marks, took 3.7 ms, and the click that opens the list 28.1 ms. The bridge's own `refresh` took 626 to 1 239 ms for
a selection and 754 to 1 457 ms for every branch (five calls each). So the selection's reading is the request, read
by the utility process under 1 000 references, and not the control; reading very many references is
E03-M01-S11's.

## What the spec holds

`test/e2e/branches-dropdown.spec.ts`, in the `application` project, seven cases against the built application,
each launch on a user-data directory of its own. Most cases are lists of steps: actions, then the box's text, the
rows the open list shows and shows checked, and the graph's top rows compared with `git log` of the same
revisions — whether the uncommitted row is above them, and whether any remote label is drawn.

1. **The bar and the list.** The label, the box and the checkbox on one row, in that order; Show All and the
   checkbox checked; the list closed, then open with its rows in the order above, under the box, as wide as it, and
   over the graph (its last row receives the pointer there); the filter's placeholder; the row under the pointer
   highlighted; a click outside closing it.
2. **Clicks.** Adding and removing one branch, the list staying open, the box naming three in list order, its
   tooltip, the graph following each click, the last unchecked returning to Show All, Show All clearing others.
3. **The double-click.** Every entry checked and the whole graph; one click unchecking only that one, with the
   graph of the rest; back to every entry, then to Show All alone.
4. **Show Remote Branches.** A remote selection dropped and a local one kept, no remote label drawn, the list
   without remote rows and the box narrower; nothing restored on re-checking, the box as wide as before; only remote
   branches checked returning to Show All.
5. **What is kept.** The selection through Refresh and Load More (600 rows, still the branch's history), the
   checkbox's state across a restart on the same user-data directory — with the selection back at Show All as this
   slice built it, and, since E03-M01-S12 changed the case, with the selection kept too — and another repository on
   that directory with remote branches shown.
6. **The keyboard alone.** Tab to the box, Enter, typing filtering case-insensitively with Show All kept, the
   arrows, Space and Enter pressing rows, the arrows back to the filter, Escape closing with the box focused, Space
   reopening with the filter empty.
7. **A thousand branches.** The list opening with 1 001 rows, nine to eleven rows tall, scrolling, a long name cut
   short with its title, reopening at the top, the filter, one selection; its two readings are written to the run's
   output.

Watched failing, by this lane on 2026-10-27 and 2026-10-28, against the built application each time:

- With the source at `Base`, which has no control, all seven fail.
- With `toggleBranch` never returning to Show All, case 2 fails and the other six pass. Case 4 was predicted to
  fail too and did not: it passes through the emptied state without reading the box there.
- With the double-click ignoring `pressedFromEvery`, case 3 alone fails.
- With `showingRemotes` keeping remote names, case 4 alone fails.
- With the entries in plain name order (the checked-out branch not first), cases 1, 2, 3, 4 and 6 fail; 5 and 7
  pass, as predicted.
- With the call of `storeRemotes` taken out, case 5 alone fails: once with the choice in `localStorage`, and
  again with it in IndexedDB.
- With `readRemotes` answering nothing for a stored path, case 5 alone fails.

The rules' own tests, `src/contracts/branch-menu.test.ts`, cover the module at 100 % of statements, branches,
functions and lines; a mutation run of that file alone, by this lane on 2026-10-27, killed all 136 mutants with a
failing test, none by timeout.

## Size

`renderer.js` measured 18 339 production bytes at `105b3c8`, the commit that added the control, against 11 847 at
this lane's base (`npm run gates:size`, 2026-10-27): `src/ui/branch-control.ts` 3 752, `src/contracts/branch-menu.ts`
1 603, and the wiring. Under the orchestrator's ruling in this slice's task its budget was reset once, to 19 456
(that size plus the margin rule of `scripts/gates/size-budget.json`), and the total by the same 7 168 bytes, to
61 440. At the lane's head, with `src/ui/remotes-store.ts` (597 bytes), it measured 18 951 on 2026-10-28, inside
that budget; it was not reset again. `renderer.css` stayed within its 6 144 bytes, at 6 107. `main.cjs` moved from
5 096 to 5 106 bytes without a change to `src/app/`: the two builds differ only in minified identifier names, the
same 831 identifier tokens with every token longer than two characters identical (compared by this lane). That
esbuild chose those names differently because `src/contracts/index.ts`, which every bundle reads, gained re-exports
is an inference, not a measurement.
