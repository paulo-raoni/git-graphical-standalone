# E04-M01-S12: the details area's size, place and options

What a reader of the code needs. The specification is `TASK-S12-panel-size-place-and-options.md`, which is not in
history. Every limit and default below is the orchestrator's choice, because no drag was ever observed in the reference
(task, *Reference behaviour*); what each statement rests on is said in *Evidence*.

## What exists now

- **The rules** are `src/contracts/details-layout.ts`: `DEFAULT_DETAILS_OPTIONS` and `DEFAULT_DETAILS_LAYOUT` (inline,
  Auto Center on, tree, compact folders on, letters off; 250 pixels, divider 0.5, no file view), the limits
  (`MIN_DETAILS_HEIGHT` 120, `MAX_KEPT_HEIGHT` 4096, `MIN_DIVIDER` 0.2, `MAX_DIVIDER` 0.8), the two checks
  `keptDetailsOptions` and `keptDetailsLayout`, and the clamps `heightRoom(place, available, row)`,
  `draggedHeight(wanted, room)` and `draggedDivider(pointer, left, width)`. Held by `details-layout.test.ts`.
- **Kept by the main process**, in `src/app/details-store.ts`: one file `details-options` and, in the folder
  `details-layouts`, one file per repository named by the SHA-256 of the path it was opened by. It writes with
  `writeRecord`, which `src/app/selections.ts` now exports (its behaviour is unchanged), so the rename-over, the retry
  and the once-per-run notice are shared. Reads are synchronous, for the reason `selections.ts` gives.
- **Channels**: `details:options`, `details:choose-options`, `details:keep-layout`; the open's reply carries
  `detailsLayout`. The bridge members are `detailsOptions`, `chooseDetailsOptions` and `keepDetailsLayout`.
- **In the window**, `src/ui/details-controls.ts` holds the two drags, the `Location` and `Auto Center` option groups,
  `setLayout`, `setOptions` and the reports; `GraphTableView` gains `setRepository(path, layout?)`, `setOptions`,
  `onOptions` and `onLayout` (`ControlsView`). `src/ui/details-panel.ts` holds the state (`place`, `autoCenter`,
  `height`, `divider`, `settings`, `layout`), `gapRow`, `placeArea`, `setPlace` and `keepInView` (was `centreBlock`).

## Where the height in force lives, and where the options are set (for E02-M03)

The height is `state.height` of `PanelState` (`details-panel.ts`), written onto the view as `--details-height`. A later
settings UI reads and sets the options through `GraphTableView.setOptions` and `onOptions`, and the main process's
`DetailsStore.options` and `choose`.

## The places the guarantee hangs on

- **The DOM and the canvas take the height from one argument.** `rowOffsetY` and `rowTopY` of `geometry.ts` take `gap`;
  `writeRows` and `paint` of `graph-table.ts` pass `state.height` and `gapRow(state)`, and `paintGraph` takes the same
  two. A function called with no height gets `DETAILS_HEIGHT`, so the existing specs compile unchanged.
- **A docked area has no gap**: `gapRow` of `details-panel.ts` answers `NO_ROW` when `place` is `docked`, so rows, canvas
  and hit test are the closed graph; the open row keeps its band through `state.open`. The list ends at the panel because
  `placeArea` toggles `graph--docked`, which shortens `.graph__scroll` and `.graph__canvas` in the stylesheet.
- **Keyed per repository and read before the first page**: `fileOf(path)` in `details-store.ts` (SHA-256 of the path);
  the open's handler reads `context.details.layout(path)`; `begin` of `renderer.ts` awaits `showStoredOptions` before
  `startupRepository` opens anything.
- **A drag writes at its release only**: `drag` of `details-controls.ts` calls `done` from `pointerup`, and only when
  the height or the divider differ from the press. A move calls `placeArea` or `writeSizes` and `schedule`.

## Decisions of the lane

- The drag of the divider keeps the pointer's offset from the divider's edge at the press, so a press with no move changes
  nothing (found by a case: it first took the pointer's position as the divider's, a 2-pixel jump).
- The options menu closes on a reply being drawn (S10's rule), so a person who presses Options while an area still says
  `Loading…` loses the menu when the reply arrives. Unchanged by this slice; the cases wait for the reply.
- `keepInView` with Auto Center off: `Math.min(top, Math.max(current, top + block - list))`; a block taller than the list
  puts the row at the top.

## Evidence

Measured, in the built application on 2026-11-14, each against a literal computed in the case:
`test/e2e/details-layout.spec.ts` (height by the bottom edge: area 350 high, every row below exactly 100 lower, stops at
120 and at the list less a row; the grey line drawn to the new foot; the divider to a quarter, a fifth and four fifths
within one pixel; a press without a move writes nothing, a held drag writes nothing until the release; fifty moves in one
task are one redraw; no timer after a release; the pool within `rowPoolSize` at both heights),
`details-docked.spec.ts` (panel box and height, rows at their closed places, the top edge, the four ways of closing, the
canvas equal to the closed one, no second request on a change of place, Load More above the panel),
`details-center.spec.ts` (Auto Center off inline and docked, on docked) and `details-kept.spec.ts` (each repository its
own after a relaunch, the options and the first area docked after a relaunch, malformed records read as nothing, no
record from an open or a scroll).

Cases added by the second session, each compared with a literal or a count, and each planted red then green (the probes are
in the audit): the docked change of place counts the calls the main process answers on the commit-details channel (none
after either change of place; the first version of the case watched only for the loading note, which a second read that
keeps the drawn text never writes, and a probe that re-asked read green until it was replaced).

**What a drag costs per frame.** `a drag of 300 pixels over 60 frames` drags the foot of the inline area 300 pixels in
60 frames, one pointer move per frame, with the details open in the middle of `large` grown to 10 000 commits, and then the
top edge of the docked panel the same way, five drags each, and prints the area's height at the start and the end of each
drag with every frame's time (the time from the move to the first task after the frame that drew it). One run on
2026-11-15, the machine's processor load sampled by `Win32_Processor.LoadPercentage` every two seconds or so over the run
(9 samples, mean 73 %, maximum 94 %, so **not a free machine**, and the sampler is not the free-machine rule's): inline
median 3.1 to 3.9 ms and worst 6.6 to 26.3 ms over the five drags, docked median 3.1 to 4.7 ms and worst 8.5 to 16.8 ms.
Each drag moved the area by 298 pixels (250 to 548), the 2 pixels being the press at the handle's middle rather than its
top; each drag back started 2 pixels lower, which the printed heights show (250 to 240 over the ten drags). No budget is
added (`ADR-0002` decision 6 names none). **A defect of the first version of this case, found and repaired here:** the
grown area's foot lay below the window's foot, so the case's drag back never reached it and four of its five inline
runs moved nothing, which read as 0.3 ms frames; the first version's printed readings were of that case and are not
kept. A grown inline area's foot is below the window whenever its row is not at the top of the list, as the
specification's clamp (the list less a row) allows, so a person reaches the handle by scrolling the list.

**What the open now reads.** The time `DetailsStore.layout(path)`, the call the open's handler makes, takes to read and
check one record, a node script over the store bundled by esbuild (not through the Electron handler), 50 repositories with
a record and 50 without, on 2026-11-15, three runs after the first, processor load 73 % (one sample): with a record,
median 0.28 to 0.40 ms, 95th percentile 0.52 to 0.74 ms, worst 0.76 to 1.10 ms; with none, median 0.15 to 0.18 ms, 95th
percentile 0.28 to 0.44 ms, worst 1.29 to 1.62 ms. A first run under heavier load (the playwright run beside it, load not
sampled) read medians of 0.80 and 0.40 ms and a worst of 50 ms, which is the load and is not kept. The budgets gate's
start cases judge the whole (the audit's readings).

**Opened and looked at** (the built application on `details`, `stashes` and `large`, 1264 x 693 pixels of view, a
Playwright-driven window; screenshots stay in the session's scratch folder). Against the reference items: inline the
area opens 250 high with the left pane starting under the Description column (item 1, item 3); the foot dragged 100
pixels down gave 350, to the foot of the window 645 (the list less a row) and, dragged up past the least, 120; the
divider dragged to a quarter gave panes of 292 and 876 pixels, to the least 234 and 934, to the greatest 934 and 234
(the fifth and four fifths of 1168); docked, the panel spans the view at the height in force with the list above it
shortened by exactly that, the open row keeps its band, the panel's top edge dragged up to 597 leaves the head and
three rows (96 pixels) (items 4, 5, 7); Auto Center off with the panel docked moved the open row with S11's Down key and
scrolled nothing, the row being in view already; Escape closed it. In both colour schemes (the window follows the
system's scheme through `emulateMedia`) the area, its handles and its controls drew as the first screenshots showed. After
closing and relaunching on one profile the options marked Tree, On, Off, Docked to Bottom and Off, the repository
that was dragged opened docked at its kept height with the divider at a fifth, and a second repository opened at 250
pixels with the divider at half, the options still docked (items 4 and 8's override, which the reference leaves
unread). Seen, and not repaired because it is S10's menu and not this slice's: the Options menu opens under its button at
a fixed position and is cut off by the window's foot when the button is low in the window, which a grown inline
area's button can be.

## Not done in this lane, and why

Nothing of scope A to H is left. Not measured: the reference was never seen dragged, so every limit stays the
orchestrator's choice (task, *Gaps*); the first session's readings are lost and are not used anywhere here.
