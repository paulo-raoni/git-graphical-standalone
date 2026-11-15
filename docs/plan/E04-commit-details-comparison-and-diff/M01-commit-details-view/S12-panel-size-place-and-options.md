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

Frames of a 300-pixel drag over 60 frames on `large` grown to 10 000 commits, printed by `a drag of 300 pixels over 60
frames` (one run, machine load not sampled): inline median 0.6 to 6.5 ms, worst 1.6 to 27.8 ms over five drags; docked
median 0.7 to 7.1 ms, worst 8.0 to 29.0 ms. The first inline drag and the second docked drag were the slow ones, which is
an observation and not an explanation. No budget is added.

Read from code: the stylesheet bounds of the docked panel (`--docked-height`), the sizes written by `writeSizes`.
Inferred: that 120 pixels keeps the controls column inside the area (98 pixels, a sum from `renderer.css`).

## Not done in this lane, and why

The audit lists what the session did not finish: the full `npm run gates` run (mutation included), the budgets readings on
a free machine, the probes of each scope, the reading of the read time of the layout record under load, and the
looking at the built window in both themes.
