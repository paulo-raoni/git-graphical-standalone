# E04-M01-S08 · Rounded lines

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S08 rounded lines

Every line of the graph that moves from one lane to another is now drawn as a curve. It leaves its upper end
going straight down and reaches its lower end going straight down, so where it meets the vertical line of the
row above or below, or the dot it leaves or reaches, the stroke has no corner. Lines that stay in one lane are
straight, as before. Nothing else in the window changed: not the layout, not the colours, not the line width,
not the dots.

*Corrected by E04-M01-S15, 2026-11-08:* this section and the next describe a curve that lies within half a row, in
the band of the row whose segment changes lane, between the two ends `segmentLines` wrote for it. That is no longer
what is drawn. Every change of lane is now one curve from the centre height of one row to the centre height of the
next, with its middle on the row boundary, as the reference extension was seen to draw it. Each of the two rows
paints the half in its own band. The control-point rule below still holds for that whole curve, `(xa, m)` and
`(xb, m)` with `m` half-way between its ends. But `segmentLines` now writes every point of each half, control
points included, and `paintRow` only strokes them, so the painter no longer derives the curve from four numbers.
`docs/plan/E04-commit-details-comparison-and-diff/M01-commit-details-view/S15-curves-as-observed.md` has the curve,
what carries the other lane, and what was seen.

## The curve

`paintRow` in `src/ui/graph-canvas.ts` takes the four numbers `segmentLines` writes for a line, `x0, y0, x1,
y1`. When `x0` equals `x1` the line is in one lane and is stroked with `lineTo`, as before. Otherwise it is
stroked with `bezierCurveTo`, a cubic Bézier curve between the same two ends, whose control points are

- `(x0, bend)`, straight below the upper end, and
- `(x1, bend)`, straight above the lower end,

where `bend` is `(y0 + y1) / 2`, the height halfway between the ends.

**Why it leaves and arrives vertically.** A cubic Bézier curve's direction at its start is the direction from
its start to its first control point, and at its end the direction from its second control point to its end.
Both control points share their end's `x`, so both directions are vertical, provided `bend` differs from `y0`
and `y1`. It does for every line `segmentLines` writes for a lane change: their ends are half a row (12 pixels)
or a whole row (24 pixels) apart vertically, so `bend` is 6 or 12 pixels from each end. That is the geometry of
the curve, not a measurement; what the drawn curve looked like is under *What was seen*.

**Why the height halfway.** With both control points at one height, the curve is point-symmetric about its own
middle: a line leaving a dot and a line arriving at one are the same shape turned over, and the curve runs
nearest to horizontal at its middle. Any height strictly between the ends keeps both ends vertical; halfway is
the one that treats the two ends alike, and it is the only height this lane drew.

**Why the painter and not the geometry.** The task left open whether the curve's shape comes from new numbers
written per line or from the painter drawing the same four numbers differently. This lane chose the painter:

- **The four numbers already decide the curve.** Vertical at both ends puts each control point straight above or
  below its end, so the only number left is `bend`, and it is computed from `y0` and `y1`. New numbers written by
  `segmentLines` would restate `x0` and `x1` and one height derived from the ends, which is nothing the geometry
  knows and the painter does not.
- **The seam stays as it was.** `segmentLines` keeps its contract, four numbers a line in an eight-number
  scratch, and the lane-change case of `test/e2e/graph-geometry.spec.ts` keeps asserting the same exact numbers,
  unchanged by this lane. The layout buffers are untouched, as the task requires.
- **It costs one comparison a line**, and the curve only on the lines that change lane.

**What that choice costs.** The curve's shape is not asserted by any test that runs without a window: no Node
test sees control points, because none are written down. The check of the shape is the golden image of
`test/e2e/golden-graph.spec.ts`, compared byte for byte, which `test/e2e/theme.spec.ts`'s golden case reads too.
The three probes of this lane's audit each turned both golden cases red and left `graph-geometry.spec.ts`
green: the straight line put back, the curve made to leave its dot at a slant (its first control point moved
halfway across, on lines whose upper end is mid-row), and only the line arriving at a dot drawn straight. The
golden image covers one fixture, `branch-and-merge`, which has one line leaving a dot and one arriving at a dot,
each across one lane; a fault that only changed a curve across two or more lanes would not reach it.

*Corrected by E04-M01-S15, 2026-11-08:* the curve's shape is now asserted without a window. Because `segmentLines`
writes the control points, `test/e2e/graph-geometry.spec.ts` asserts every half it writes, across one lane and
across three, against the curve cut at its middle. The golden image is still the check on the drawn pixels, and was
recorded again by that slice.

## What was seen

**How.** The built application (`npm run build`) was launched with this project's own end-to-end launcher,
`launchBudgeted` of `test/e2e/support/budgets.ts`, from a scratch spec outside the repository, on the
`branch-and-merge` and `remotes` fixtures that `test/e2e/support/fixtures.ts` builds, with the graphics processor
and a 1280 × 800 window. Once the graph was painted, the canvas was read back pixel for pixel (`readCanvas` of
`test/e2e/support/budgets-page.ts`) and enlarged by nearest neighbour to be looked at: once at the default
device pixel ratio of 1, enlarged eight and six times, and once with `--force-device-scale-factor=4`, so that the
canvas drew four pixels for every one and the curve's shape could be seen at all, enlarged twice. `remotes` was
read at three scroll offsets, rows 0, 12 and 24. The `branch-and-merge` canvas of the golden case, drawn in
software at 960 × 600, was looked at the same way, beside the golden image it replaced. The images are in the
executor's scratch folder and none is in the repository. What follows is what was seen on 2026-11-07 on this
machine, at those two ratios.

- **A line leaving a dot, which here is always a merge.** `branch-and-merge` row 0 is a merge in lane 0 whose
  second parent is in lane 1; `remotes` row 1 is the same, a merge in lane 0 with its second parent in lane 1.
  Each red line comes out of the dot's lower right edge already heading down and to the right, crosses half a
  row, and turns down into lane 1, where it meets lane 1's vertical line at the row's lower edge with no visible
  angle. The curve's first stretch, where it is vertical, lies under the dot: it starts at the dot's centre and
  the dot's radius is 3.5 pixels. At ratio 1 the turn into lane 1 reads as a rounded bend two or three pixels
  long; in the image the golden case replaced, drawn by the straight line before this lane, the same place is a
  sharp angle. In both fixtures no line left a dot other than a merge's further parent.
- **A line arriving at a dot, one lane across.** `branch-and-merge` row 3, where the red branch began: the red
  line leaves lane 1 at the top of the row going straight down, bends, crosses toward lane 0 and enters the dot.
  `remotes` row 12 is the same shape. The join with lane 1's line above has no corner; the end at the dot is
  hidden by the dot, as at a merge.
- **A merge, as a whole.** The red loop of `branch-and-merge`, out of row 0's dot, down lane 1 through row 2's
  red dot, and back into row 3's dot, is one smooth line from dot to dot: two S-curves joined to a vertical
  stretch, no corner anywhere along it.
- **A line across more than one lane.** `remotes` has two, both arriving at a dot in lane 0: a green line from
  lane 2 at row 14, 28 pixels across in 12 down, and a purple one from lane 3 at row 17, 42 pixels across in 12
  down. Each leaves its lane going straight down with a tight rounded turn, runs as a long shallow line most of
  the way across, and enters the dot at a shallow slant, its vertical end again inside the dot. No corner at
  either end. The wider the line, the more of its turn sits close to its two ends: at ratio 1 the purple line's
  turn out of lane 3 is about two pixels of rounding and the rest of it reads as a nearly straight shallow line.
  That is this curve's shape when the distance across is several times the 12 pixels down, and it is the
  owner's to judge whether it is the look wanted.
- **Unchanged.** Every line within one lane, the dots, the hollow dot of the uncommitted row and the ring of
  `HEAD`'s commit looked as in the image the golden case replaced. A faint lighter notch where two rows' straight
  lines meet, visible at both ratios on every vertical line, is in that image too and is not this lane's.

## The golden image, recorded again

`test/e2e/golden/graph-branch-and-merge.rgba.deflate` was recorded on 2026-11-07, after the looking above, by
this procedure, which no document held before:

1. Build (`npm run build`) and run the golden case alone:
   `npx playwright test --project=application test/e2e/golden-graph.spec.ts`. It goes red, and on a mismatch it
   writes what it drew to `test-results/golden/graph-branch-and-merge.drawn.rgba.deflate`.
2. Look at that file. It is the canvas's unpremultiplied RGBA, 64 pixels wide at this window size, deflated; this
   lane inflated it, composited it on white and wrote it as an enlarged picture to look at.
3. Run the case again and compare the two drawn files. This lane's two runs wrote byte-identical files.
4. Copy the drawn file over the golden file, and run the golden case and `theme.spec.ts`'s golden case. Both
   were green with the recorded file in place, before this lane's first commit.

The new image differs from the one it replaced in 109 of its 34 176 pixels, all between canvas rows 13 and 82,
which are the rows of the two curves (counted by comparing the two inflated buffers four bytes at a time).

## Size

`renderer.js` measured 18 610 production bytes at Base and 18 696 at this lane's head, by `npm run gates:size`
on 2026-11-07, against its budget of 19 456, which this lane did not change.

## The frame budget

The scrolled case of `test/e2e/budgets-frames.spec.ts` was read on 2026-11-07, at this lane's head (`11718fe`)
and at Base's painter: the same tree with `src/ui/graph-canvas.ts`, `src/ui/geometry.ts` and
`src/contracts/layout.ts` checked out from Base and built, the three source files this lane changed. The
readings were interleaved, head then Base, three rounds, then a whole `npm run gates:budgets` at head. Each was
started only after a minute whose other load averaged under 40 per cent with no sample over 75, and with no other
gate run of this project listed. Load was sampled every 2 seconds from the operating system's process table: the
idle process's processor time gave the machine's load, and the processor time of the reading's own processes,
each known by its id and its creation time, was taken out of it.

| reading | other load, minute before / during / highest | reference 95th percentile | mean per reference | fifth-slowest per reference | longest as timed |
| --- | --- | --- | --- | --- | --- |
| head, round 1 | 24.8 / 24.9 / 72.0 % | 4.7 ms, **discarded** | 4.649 | 6 | 7.4 |
| Base, round 1 | 37.6 / 16.6 / 40.8 % | 3.8 ms, kept | 4.711 | 5.959 | 7.7 |
| head, round 2 | 22.2 / 9.0 / 40.7 % | 3.2 ms, kept | 4.895 | 6.168 | 7.2 |
| Base, round 2 | 13.8 / 9.8 / 33.3 % | 3.5 ms, kept | 4.994 | 6.038 | 7.3 |
| head, round 3 | 15.3 / 8.4 / 27.9 % | 3.2 ms, kept | 4.947 | 6.072 | 6.8 |
| Base, round 3 | 13.7 / 8.4 / 30.1 % | 3.2 ms, kept | 4.942 | 5.942 | 6.8 |
| head, whole `gates:budgets` | 13.6 / 11.7 / 48.8 % | 3.7 ms, kept | 4.628 | 6 | 7.1 |

All in milliseconds; the limits are 7.41 for the mean (baseline 4.94 times 1.5), 10.0365 for the fifth-slowest
(6.691 times 1.5) and 16.7 for the longest frame as timed, the literal verdict. Every kept reading is green on all
three verdicts, at head and at Base. Kept head readings read 4.628 to 4.947, 6 to 6.168 and 6.8 to 7.2; kept
Base readings 4.711 to 4.994, 5.942 to 6.038 and 6.8 to 7.7. The two ranges overlap on every verdict, so these
six kept readings show no cost of the curve that this case can tell from its own spread; they do not show that
there is none. An earlier whole `gates:budgets` at head, at 08:24 UTC, read the scrolled case at 33.2 per cent
other load before it and 42.4 during it, highest 86.0, with a reference percentile of 5.5 ms: not free and
discarded on both counts.

## Sentences corrected

- `src/contracts/layout.ts`: the vocabulary still holds no curves, because the buffer is unchanged; the comment
  now says that the painter draws a segment whose two lanes differ as a curve, and that this adds nothing to the
  vocabulary.
- `segmentLines` in `src/ui/geometry.ts`: its doc comment now says that it writes a line's two ends and never its
  shape, and that "leans" names the curve's course, not a straight diagonal.
- `docs/plan/E01-commit-graph/M01-first-graph/S01-scaffold-and-contract.md` and `S05-graph-table-renderer.md`:
  each has a dated note under the sentence it corrects. In S01 the sentence is about the buffer's vocabulary, and
  the note says it is still true of the buffer and no longer true of the drawing. In S05 the table's ends still
  hold and the note says what is drawn between them.
