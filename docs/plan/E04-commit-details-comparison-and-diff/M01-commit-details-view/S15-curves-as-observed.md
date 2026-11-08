# E04-M01-S15 · Curves as observed

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S15 curves as observed

Every line of the graph that moves from one lane to another is now drawn the way the reference extension was seen
to draw it on 2026-11-08: one S-curve from the centre height of one row to the centre height of the next, vertical
at both ends, with its middle on the boundary between the two rows, whether it moves one lane or three. E04-M01-S08
had drawn the same kind of curve inside half a row. Lines that stay in one lane are straight, as before. The
layout, the colours, the line width, the lane spacing and the dots did not change.

## The curve

For a move from lane `a` at the centre of row `r` to lane `b` at the centre of row `r + 1`, the curve is the cubic
Bézier curve from `(xa, ya)` to `(xb, yb)` whose control points are `(xa, m)` and `(xb, m)`, where `m` is the
height of the boundary between the two rows. That is the shape the observer inferred and labelled as an inference
(item 4 of the task's reference behaviour), and it is S08's control-point rule applied to a curve one row high
instead of half a row.

- **Vertical at both ends.** Each control point is straight below or above its own end, so the curve's direction
  at each end is vertical.
- **Symmetric about its middle.** Both control points are at the boundary's height, so the curve is point-symmetric
  about `((xa + xb) / 2, m)`, which is on the boundary.
- **One row high however wide.** The ends are a row apart whatever the lanes are; a wider move only moves `xa` and
  `xb` apart, so its middle runs flatter.

That is the geometry of the cubic, not a measurement. What the drawn curve looked like is under *What was seen*.

**Each row paints the half in its own band.** The canvas is painted row by row (`docs/ADR-0002-architecture-and-performance.md`
decision 5), and the curve crosses a row boundary. So the curve is cut at its middle, at `t = 1/2`, by de
Casteljau's construction, and each row writes its half as one cubic piece. The row above paints the first half,
from its centre to the boundary, with control points `(xa, ya + 6)` and `((3xa + xb) / 4, ya + 9)`. The row below
paints the second half, from the boundary to its centre, with control points `((xa + 3xb) / 4, m + 3)` and
`(xb, m + 6)`. With a row 24 pixels high, these are the cut's exact points, so the two halves are one curve.
`test/e2e/graph-geometry.spec.ts` computes the cut from the whole curve's four points, separately from the code,
and asserts that every half the code writes equals it.

## What carries the other lane: the neighbouring row's segments

The task left open what tells a row that its line bends above or below it. This lane chose **the painter reading
the neighbouring row's segments**, and changed nothing in `src/core/layout/` or `src/contracts/layout.ts` except
two comments.

- **The buffer already says it.** A line that leaves row `r`'s bottom edge in lane `L` enters row `r + 1`'s top
  edge in lane `L`. Row `r + 1`'s segment that starts in `L` says where the line is at that row's centre: its
  `segmentToLane` when it arrives at the vertex, `L` otherwise. Upwards it is the same: row `r - 1`'s segment that
  ends in `L` says where the line was at that row's centre, which is its `segmentFromLane`. A new column would
  repeat facts the buffer already holds.
- **At most one line crosses an edge in a lane other than the vertex's.** The layout gives every line a lane of
  its own. A line born at the vertex starts at the centre, not at the top edge, and a line arriving at the vertex
  ends at the centre, not at the bottom edge. So the first matching segment is the line. In the vertex's own lane,
  the line meets the vertex in that lane and the answer is the lane itself. This is an argument from
  `crossOpenLanes` and `openDepartures` in `src/core/layout/lane-layout.ts` as they read today, and it holds while
  they emit their segments that way.
- **The cost is a walk over one neighbouring row's segments,** at most twice per segment painted. That is the
  graph's width at that row, never anything that grows with the page. Painting a viewport now reads the segments
  of one row above and one row below the drawn slice as well.
- **The layout's cost cannot move,** because its code did not change. The perf gate's layout readings at this
  head are under *Gates*.
- **What it costs.** `segmentLines` now takes the rows and a segment index instead of the four numbers it took
  before, and it writes fourteen numbers instead of eight: a start point and, per half, two control points and
  an end. The control points are written by the geometry, not computed by the painter. So a test that runs without
  a window sees the curve's shape, which S08's slice document said no test could.

No new fact is written to the layout buffer, so there is no new name or encoding to give one.

### Where the curve sits

A curve is placed in the gap between the two rows where the line's lane at the centre height differs. The layout
changes a line's lane only at a row where it is born at a vertex or dies at one. So the curve always sits in the
gap next to the commit whose lane the line leaves or joins, and the rest of the line is straight:

- **a merge** whose further parent is laid out in another lane curves out in the gap directly below the merge's
  dot, then runs straight down;
- **a branch** that forks from a commit runs straight down its lane to the centre of the row above that commit,
  and curves into its dot in the last gap.

`test/e2e/graph-geometry.spec.ts` holds both with fixtures laid out by the real layout pass. Each asserts the
complete list of curved halves on the page: the two ends of each curve, the row each half is painted in, and that
no other half curves. A curve moved into another gap of the same line therefore fails it.

### Edges and clip bits

- **The clip bits keep their meaning.** In the vertex's own lane, the half above the dot is painted only when
  `ClipAboveVertex` is clear, and the half below only when `ClipBelowVertex` is clear, exactly as
  `src/contracts/layout.ts` requires. Every other lane's line crosses the whole band.
- **At the first and last loaded rows** there is no neighbour to read, and the line is taken to stay in its lane.
  A line born at the last loaded row and leaving it in another lane is drawn as the first half of a curve towards
  that lane, ending half-way across at the bottom edge. Once the page below is loaded, the next row's segments
  complete it.
- **The uncommitted row.** `src/core/page/graph-page.ts` gives that row one `(0, 0)` segment and the first commit's
  row `ClipAboveVertex`. So, as before this lane, its line stops at its row's bottom edge and does not reach the
  first commit's dot. In the built application on `remotes` the gap is plainly visible: about 8.5 pixels, which is
  half a row less the dot's 3.5-pixel radius. That is an inference from the geometry, not a measured distance.
  This lane did not change it, and raises it in its audit.

## Crossings and the drawing order

`paintGraph` in `src/ui/graph-canvas.ts` paints in two passes. First the curved halves of every drawn row. Then,
row by row, the straight halves and that row's dot. A half is curved when its two ends have different `x`.

- **A vertical line over a curve.** Every curve is stroked before any straight line, so wherever a curve crosses
  another lane's vertical, the vertical is on top, whichever lane is further left. Item 6 records two things of
  the crossings the observer saw: the vertical was on top, and the line of the lane further left was on top. It
  labels as an inference that the second is a rule of the drawing order. This lane follows the first. It agrees
  with every crossing item 6 describes. It would differ only where a curve from a lane further left crosses a
  vertical further right, and item 6 does not say that such a crossing was seen.
- **Two curves crossing.** Both are in the first pass, so the curve stroked later is on top. Within one band that
  is segment order: the lines that pass through the row in lane order from the left, then the lines born at its
  vertex. Two curves can cross only inside one gap, and the crossing lies in one band. Which curve is on top
  therefore depends on that band's segment order, and can differ between two crossings that look alike. Nothing
  in the reference behaviour this lane was given says which is on top, and no fixture this lane looked at has
  two crossing curves.
- **Dots over lines.** Every dot is drawn after every curve, and after its own row's straight lines. A row's lines
  stay inside its band, so no later row's line reaches an earlier row's dot.
- **One stroke per line per row.** A segment's two halves meet at its row's centre height. When both are of the
  kind being painted they are one stroke, so a straight line through a row has no join there.

Neither fixture looked at here has a curve crossing another lane's vertical (see *What was seen*). The geometry
tests run without a window and cannot see stroke order. The check that holds
the order is the golden image: on `branch-and-merge` the red curve leaves lane 0 beside lane 0's blue vertical,
just below the merge's dot, and joins it again above the dot of row 3. There the two strokes overlap. With the
passes swapped, both golden cases went red on 12 pixels between canvas rows 15 and 80 (this lane's audit has the
probe). The check holds the order of the passes, which is what decides every crossing. It does not hold a crossing
of a curve over another lane's line.

## What was seen

**How.** The built application (`npm run build`) was launched on 2026-11-08 with this project's own end-to-end
launcher, `withBudgeted` of `test/e2e/support/budgets.ts`, from a scratch spec outside the repository. It ran on
the `branch-and-merge` and `remotes` fixtures that `test/e2e/support/fixtures.ts` builds, with the graphics
processor, at device pixel ratios 1 and 4 (`--force-device-scale-factor=4`). Once the graph was painted, the
canvas was read back pixel for pixel (`readCanvas`), composited on white and enlarged by nearest neighbour: eight
and six times at ratio 1, twice at ratio 4. `remotes` was read at scroll offsets of rows 0, 12 and 24. Each row's
text was read beside it, to name the commits. The `branch-and-merge` canvas of the golden case was looked at the
same way. The images are in the executor's scratch folder, and none is in the repository. Against the seven items
of the task's reference behaviour:

1. **The shape.** Every move between lanes in both fixtures is one smooth S-curve with no straight segment and no
   corner. It leaves its start going straight down and arrives going straight down, and the two turns look alike,
   one the other turned over.
2. **Its height.** On `branch-and-merge` at ratio 4, the merge's red line leaves the dot of row 0 and reaches lane 1
   at the centre height of row 1. Its middle crosses the boundary between rows 0 and 1. The fork's line leaves the
   red dot of row 2 and reaches the blue dot of row 3 at its centre. On `remotes`, the moves across one, two and
   three lanes each start at one row's centre and end at the next row's.
3. **Where it sits.** On `remotes`, the merge of row 1 (*merge the topic*) curves out in the gap directly below its
   dot to the red dot of row 2. The red line then runs straight down lane 1 and curves into lane 0 in the gap above
   row 12 (*commit 4997*). The green line of lane 2 runs straight down to the centre of row 13 and curves into
   row 14 (*commit 4995*). The purple line of lane 3 runs straight down to the centre of row 16 and curves into
   row 17 (*commit 4992*), the move from lane 3 to lane 0 that review round 04 saw near that row. No curve was spread
   along a line.
4. **Wide moves.** The purple move across three lanes is as tall as the red move across one, and only wider. Its
   middle runs nearly flat, and both turns are fully rounded: a flattened Z. At ratio 1 it reads as a shallow line
   with a short rounded bend at each end.
5. **A fork and a merge.** The merge's curve out of row 0 and the fork's curve into row 3 on `branch-and-merge` are
   the same shape mirrored. Neither fixture has several forks reaching one commit at once, so nesting was not seen.
6. **Crossings.** Neither fixture shows a curve crossing another lane's line where the drawing order would show:
   on `remotes` the green and purple curves cross lanes 1 and 2 where those lanes hold no line. The order was seen
   only where a curve leaves or joins a vertical of its own lane's neighbour, under *Crossings* above.
7. **Proportions.** Not in scope and unchanged: 14 pixels between lane centres against a row height of 24.

**Also seen, and not this lane's.** `remotes` has a dirty working tree. Its uncommitted row's hollow dot sits above
row 1, and the line below it stops at the row's bottom edge, short of row 1's dot, as under *Edges and clip bits*.
The faint lighter notch where two rows' straight lines meet, which S08's slice document describes, is still at
every row boundary.

## The golden image, recorded again

`test/e2e/golden/graph-branch-and-merge.rgba.deflate` was recorded on 2026-11-08, after the looking above, by the
procedure in S08's slice document:

1. The build at this lane's change, then `npx playwright test --project=application test/e2e/golden-graph.spec.ts`.
   It went red and wrote what it drew to `test-results/golden/graph-branch-and-merge.drawn.rgba.deflate`.
2. That file was inflated, composited on white, enlarged eight times and looked at. It shows the two curves above
   from row centre to row centre.
3. The case was run again. Its drawn file was byte-identical to the first.
4. The drawn file was copied over the golden file. The golden case and `test/e2e/theme.spec.ts`'s golden case were
   then both green.

The new image differs from the one it replaced in 361 of its 34 176 pixels, all between canvas rows 14 and 120
(counted by comparing the two inflated buffers four bytes at a time). Most are the two curves. Some are in lane 0
away from any curve, in row 4 for example. There the alpha differs by at most 1, read at four heights of that row.
This lane infers that those come from stroking a segment's two halves as one path instead of two. It did not
isolate them.

## Size

`renderer.js` measured 19 708 production bytes at this lane's head and 19 182 at its base, by `npm run gates:size`
on 2026-11-08. The base was measured over a `git archive` of `8268e69`. That is 526 bytes over a 274-byte margin,
so its budget was reset once by the margin rule to 21 504, and the total to 75 545
(`comment-e04-m01-s15` in `scripts/gates/size-budget.json`).

## Gates

The layout did not change, and the perf gate's layout readings at this lane's head (`e4d9fc5`, `npm run gates:perf`
on 2026-11-08) were:

- 130.49 typed-array bytes allocated per row, against a baseline of 130.491;
- 18.747 units of layout work per row, against 18.747;
- 3.965 times the work at 40 000 rows over 10 000, against 3.966.

## The frame budget

All readings were taken at this lane's head, `e4d9fc5`, and at Base. Base was a `git archive` of `8268e69`, built
and run in a scratch folder with the same dependencies, so it carries S08's painter. All were taken on 2026-11-08,
interleaved, each started only after a minute whose other load averaged under 40 per cent with no other gate run
of this project listed. Two instruments sampled the load:

- **S08's driver:** the operating system's process table every 2 seconds, the reading's own processes known by id
  and creation time and taken out;
- **a Windows job object:** every second, the job's own processor time taken out. The job counts every process
  that was ever in it, short-lived ones included. These are the `job-` readings.

A reading is kept when the minute before it and the reading itself averaged under 40 per cent other load, no
sample during it was over 75, and its reference timings' 95th percentile was 4 ms or under (`AGENTS.md` §11).

| reading | other load, minute before / during / highest | reference 95th percentile | mean per reference | fifth-slowest per reference | longest as timed | kept |
| --- | --- | --- | --- | --- | --- | --- |
| head 1 | 33.8 / 19.9 / 85.5 % | 4.0 ms | 4.823 | 5.959 | 7.7 | no: a sample over 75 |
| Base 1 | 30.3 / 23.0 / 72.0 % | 4.3 ms | 4.965 | 6.21 | 8.2 | no: percentile |
| head 2 | 35.5 / 39.1 / 77.1 % | 6.8 ms | 4.484 | 6.517 | 10.1 | no: both |
| Base 2 | 34.7 / 33.7 / 84.2 % | 5.9 ms | 5.088 | 6.377 | 13.3 | no: both |
| head 3 | 35.9 / 14.1 / 51.5 % | 3.6 ms | 4.828 | 5.855 | 7.7 | **yes** |
| Base 3 | 36.3 / 20.7 / 72.8 % | 4.4 ms | 5.148 | 6.256 | 8.6 | no: percentile |
| head 4 | 39.2 / 17.9 / 65.3 % | 3.7 ms | 4.881 | 5.855 | 7.0 | **yes** |
| head, whole `gates:budgets` | 35.5 / 17.9 / 54.4 % | 4.1 ms | 4.62 | 6.348 | 8.6 | no: percentile |
| Base 4 | 28.0 / 33.4 / 82.5 % | 4.5 ms | 4.627 | 6.482 | 11.8 | no: both |
| head 5 | 37.0 / 33.3 / 90.9 % | 4.4 ms | 4.47 | 6.024 | 8.6 | no: both |
| Base 5 | 30.1 / 38.9 / 81.1 % | 6.0 ms | 4.621 | 6.174 | 9.9 | no: both |
| head 6 | 22.5 / 22.9 / 52.7 % | 4.4 ms | 4.627 | 6.232 | 10.1 | no: percentile |
| Base 6 | 27.4 / 27.0 / 76.0 % | 4.3 ms | 4.564 | 6.716 | 9.0 | no: both |
| head, second whole `gates:budgets` | 35.2 / 31.9 / 68.3 % | 5.5 ms | 4.431 | 6.703 | 11.0 | no: percentile |
| Base 7, job | 21.6 / 21.0 / 59.0 % | 4.1 ms | 4.628 | 6.469 | 9.3 | no: percentile |
| Base 8, job | 27.9 / 18.4 / 43.0 % | 3.7 ms | 4.691 | 6.024 | 7.2 | **yes** |
| head 7, job | 38.9 / 36.5 / 75.0 % | 6.6 ms | 4.646 | 6.383 | 8.8 | no: percentile |
| Base 9, job | 35.2 / 43.9 / 79.0 % | 7.7 ms | 4.82 | 6.79 | 12.2 | no: both |

All times are in milliseconds. The limits are 7.41 for the mean, 10.0365 for the fifth-slowest and 16.7 for the
longest frame as timed. Every reading, kept or not, was under all three. While these readings were taken, the
process table listed two other lanes' gate runs of this project at times. The job samples name the WSL virtual
machine (`vmmemWSL`, outside this project) and the malware scanner among the busiest processes outside the reading.

- **Kept at head:** 4.828 and 4.881 for the mean, 5.855 twice for the fifth-slowest, 7.7 and 7.0 for the longest.
- **Kept at Base:** one reading, at 4.691, 6.024 and 7.2.
- **What that shows.** The two kept head means lie 0.14 to 0.19 ms above the one kept Base mean. Their
  fifth-slowest and longest lie below it. One Base reading cannot say whether a difference of that size is the
  curve's cost or the spread between readings.
- **Other figures, not measured here.** S08's slice document records kept readings of its own painter, which is
  Base's, at 4.711 to 4.994 for the mean. Those are S08's measurements, and this lane did not reproduce them.
- **What these readings do show:** the kept readings at head are inside the frame budget with the margin
  above.

**The cases of `gates:budgets` other than the scrolled one.** Both whole runs passed all six cases and the
three timed benchmarks. Read against the same rule:

- **Benchmarks:** free in the second run (34.3 / 34.5 / 59.0 %).
- **The memory case:** free in the first run (18.4 / 31.9 / 72.8 %).
- **The three cold-start cases and the large-load case of `open-repository.spec.ts`:** not free in either run.
  Across the two runs, other load during them was 34.9 to 75.9 per cent, with samples up to 96.9. They were read a
  third time inside the job object (25.1 / 49.5 / 70.0 % for the first case), and were again not free, and green.
- **Why.** In that job reading, the operating system's malware scanner (`MsMpEng`) was the busiest process
  outside the job in 27 of 68 samples, at 13.5 per cent of the machine on average when it was. In the job reading of
  the scrolled case just before (Base 7), it was the busiest in 13 of 74 samples, at 5.0 per cent on average.
- **Not this lane's machine alone.** S08's own whole run of 2026-11-07, read again by this lane with the same
  per-case arithmetic over S08's samples, shows the same pattern on a quiet machine. The first cold-start case had
  13.9 per cent other load in the minute before it and 55.3 during it.
- **An inference, not a measurement.** That each launch of a fresh profile makes the scanner work for the reading,
  outside its process tree, so that §11's measure cannot keep a cold-start reading on this machine.

## Sentences corrected

- `src/contracts/layout.ts`: the paragraph on the vocabulary now says that the lanes a segment names are where the
  layout puts the line. The painter draws a change of lane as one curve from row centre to row centre, half-way
  between the lanes at the boundary, and finds the other lane from the neighbouring row's segments. The two
  edge-lane fields now say the same.
- `segmentLines` in `src/ui/geometry.ts`: its doc comment is new, as is the function's contract.
- `docs/plan/E04-commit-details-comparison-and-diff/M01-commit-details-view/S08-rounded-lines.md` and
  `docs/plan/E01-commit-graph/M01-first-graph/S05-graph-table-renderer.md`: a dated note under each sentence this
  lane made false.
