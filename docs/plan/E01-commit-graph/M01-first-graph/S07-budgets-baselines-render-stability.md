# E01-M01-S07 · Budgets, baselines and render stability

What a reader of the code needs to know about the slice that measured the assembled application against the
ten budgets of `docs/ADR-0002-architecture-and-performance.md` decision 6: what each budget measured, how, and
whether the application meets it; where each baseline lives and which gate reads it; how a run is held
strictly on the development machine and widely on a CI runner; what the size budgets calibrated to; and the
answer to the golden-image question of `docs/ADR-0003-quality-gates-and-ci.md` decision 5.

## The machine, and the condition it was in

Every figure below was measured by this slice's executor on **2026-09-28**, on the development machine: an
Intel Core i5-10310U (four cores, eight threads, 1.7 GHz base), 16 GB of memory, Intel UHD Graphics, Windows 11
Pro 10.0.26200, a display running at 60 Hz with a device pixel ratio of 1. Node 24.18.0 ran the gates; the
application ran on Electron 44.3.0, which is Chromium 152 and Node 24.20. **Load condition:** no other build,
gate or test was running during any measurement, and each run of the end-to-end suites started exactly one
application at a time; the owner's desktop session was otherwise as it was left, which this lane did not
control and did not measure.

**The memory row was measured again on 2026-10-03**, after the owner's ruling (below), by a second executor
context on the same machine and the same Electron, between 02:15 and 02:44 local time. That time the machine
was not quiet: another project's mutation run and other agent sessions were running, which this slice did not
start and did not stop. The processor load sampled from `Win32_Processor` before each run read 29 to 100 per
cent, and free physical memory 0.66 to 5.17 GB of 16. Each figure from that day says so.

## The ten budgets, measured

| budget | limit | measured | runs, range | verdict |
| --- | --- | --- | --- | --- |
| Cold start to a painted window, empty repository | ≤ 1500 ms | fastest of ten launches, **991 ms** (median of five runs) | five runs on 2026-10-03: fastest 958 to 1096 | meets |
| Load 10 000 commits, to rows painted | ≤ 800 ms | fastest of ten Refreshes, **423.5 ms** (median of five runs) | five runs on 2026-10-03: fastest 418.4 to 539.4 | meets |
| Parse throughput, streamed log | ≥ 20 000 / s, held as ≤ 50 µs a commit | **14.579 µs** a commit, 68 600 / s | fastest of five in each of six sessions: 14.468 to 15.768 µs | meets |
| Lane layout throughput | ≥ 200 000 / s, held as ≤ 5 µs a commit | **0.59 µs** a commit, 1.69 million / s | fastest of five in each of six sessions: 0.570 to 0.590 µs | meets |
| Structural memory per loaded commit | ≤ 96 bytes | 85.519 at the worst size | the committed baseline, re-run at the lane's base | meets |
| Memory, all processes, 50 000 commits: the sum of their private bytes | ≤ 400 MB | median **157 372 416 bytes** (150.1 MiB), read once the load's memory has come back | five runs on 2026-10-03, 147.6 to 154.1 MiB | meets |
| Resident memory growth over 5 minutes idle | ≤ 2 % | **+0.2 %** (ratio 1.002), from the settled reading | five five-minute runs on 2026-10-03: 0.853 to 1.006 | meets |
| Main-thread work per frame while scrolling | ≤ 8 ms, no frame over 16.7 ms | mean **5.24 ms**, worst frame **7.7 ms** | five runs of 240 frames: means 5.13 to 5.34, worsts 7.3 to 8.1 | meets |
| Live DOM row elements | ≤ viewport rows + 2 × overscan | **37**, at 300 and at 10 000 commits | every run | meets, at the bound |
| CPU while idle, no timer wakeups | ≈ 0 % | **0.063 %** of one core; **0** wakeups in the page and the main process | five five-minute runs: 0.063 to 0.453 % | meets |

What each row measured and how follows. The memory and idle rows are five runs of one case, not five runs inside one, because each
reading takes five real minutes and the gate itself runs it once; that is said beside each.

### Cold start, empty repository

**What:** the time from the operating system creating the application's main process to the window painted
over a repository with no commits, named on the command line. **How:** `test/e2e/budgets-start.spec.ts`
makes the repository with `git init`, launches the built application with it ten times, and reads the
process's creation time from Windows' own process table; the end is the first paint mark (below) showing that
repository's path in the bar and the empty table. **The fastest of the ten is what is compared.** **Runs**,
measured again by E01-M01-FIX-27 on 2026-10-03 between 08:20 and 08:26, five runs of the spec with the
processor load sampled every five seconds at 15 to 80 per cent and free memory at 4.28 to 5.01 GB: the fastest
of ten read 999, 958, 991, 972 and 1096 ms, and the baseline is their median, 991. Single launches in those
runs read 958 to 2196 ms.

Beside it, the case a person actually starts on — S06's first item — with the ten-thousand-commit fixture on
the command line and its first page of 300 painted, the same five runs: fastest of ten 1031, 1014, 1100, 1040
and 1045 ms, baseline 1040; single launches 1014 to 2273. That one has no budget of its own, so it has a
baseline and no ceiling.

**Why the fastest of ten, and not the median of five** that S07 held on 2026-09-28 (empty 994 to 1156, median
1068; with the fixture 969 to 1469, median 1105). The machine is shared with other agents, and on 2026-10-03,
between 07:50 and 07:58, ten runs of the spec as it then was went red **seven times** on a product nothing had
changed: the empty median read 1081 to 1719 against a limit of 1500 (red six times), the fixture's 1120 to
1745 against 1657.5 (red twice), and the load's 435 to 731.6 against 656.6 (red once), with the processor load
sampled at 17 to 100 per cent and free memory at 3.69 to 5.44 GB during the last eight runs (the sampler of the
first two did not start). Load from other programs only ever adds to a reading, and it comes in bursts of
seconds, which move several readings of five together and the median with them. The fastest of ten is moved
only when all ten met the load; a regression of the product moves every reading, the fastest included. What it
cannot see is a regression that slows some launches and not others, which the median of five would have seen
when it slowed three; that is the price, the same one the benchmarks in `perf/` pay.

**What it does not survive.** Thirty runs of the spec on 2026-10-03, load sampled every five seconds. With
the ten Refreshes in one window, between 08:35 and 08:50 and between 10:47 and 11:01: sixteen of twenty green. One
red run had a window whose ten Refreshes all ran slow (under *Ten thousand commits*), which is why they are now
shared between two windows. The other three met minutes on end at 76 to 100 per cent: one red on the load
alone, fastest of ten 792.4 ms with single Refreshes up to 2069; one red in all three cases, empty 1736, with the
fixture 2557, load 1323, free memory 2.64 to 3.49 GB; one red on the fixture and the load, 1578 and 2159.3. As
the spec is now, between 11:33 and 11:48, at 10 to 100 per cent and free memory 0.45 to 5.91 GB: **ten of ten
green**, fastest of ten empty 1001 to 1379 ms, with the fixture 998 to 1518, load 419.8 to 500.5. And five
runs of the load case alone, between 11:05 and 11:12, with the load at 100 per cent nearly throughout: all red,
fastest of ten 1203.2 to 1830. Twice in those minutes the load was seen to be another project's mutation run,
with seven workers at a whole core each beside the antivirus at under one. When every logical processor is
busy for longer than the readings take, every reading is the product's real time on that machine, and it is
over the budget; no statistic of the readings changes that, and whether the strict regime is meant to hold
then is the owner's question, raised by E01-M01-FIX-27.

**Where a slow cold start spends its time**, measured with git's own trace (`GIT_TRACE2_EVENT`), the
processes' creation times from Windows' process table and the page's paint marks, in fourteen launches on
2026-10-03 at two loads (git's trace itself costs time, so these launches read slower than the gate's). At 28
to 73 per cent, 1300 to 1687 ms: Electron's own start to the window's shell painted took 421 to 605 ms; the open
is six git processes run one after another, from the first one's start to the last one's exit 722 to 1044 ms,
of which git's own traced run was 198 to 275 ms and the rest the gaps between them; the last exit to the
painted mark took 43 to 57 ms. At 23 to 100 per cent, 1548 to 3813 ms: the shell 488 to 1019, the six git
processes 828 to 2243 (inside git 297 to 588, gaps 531 to 1656), the last 17 to 61. So the time a busy machine
adds goes mostly into starting the git processes and some into Electron's start. What a gap consists of —
the utility process's turn-around, Windows creating the process, git's start before its trace begins — the
instruments used here cannot separate, and in some launches a gap was about 105 ms longer than its neighbours
at any load; that is not attributed.

### Ten thousand commits, one load, to rows painted

**What:** one read of git, one parse, one store, one layout of ten thousand rows from a fresh state, two
structured clones and one paint. **How it is one load without a product change:** an open reads 300 commits
and nothing on the bridge asks for more in one read, but a Refresh does — `src/app/repository-host.ts` reads
the open repository again at the size already loaded, into a fresh store, and lays out every row from a fresh
layout state. So the case grows the utility process's state to 10 000 commits with one Load More over the
bridge, **without drawing it**, and then presses Refresh. What that leaves out of a real first open is finding
git and starting the utility process, both paid once and both inside the cold-start figures. The clock runs
from the press to the first mark showing 10 000 rows, `commit 10000` at the top, ink on the canvas and the
control back at rest. Ten Refreshes, five in each of two windows, each after a second's pause so that they do
not all fall in one burst of load, and **the fastest is what is compared**, for the reason given under the
cold start. **Runs:** first with all ten in one window, in the same five runs of 2026-10-03 (load 15 to 80 per
cent): fastest of ten 418.4, 539.4, 423.5, 420 and 424.4 ms, and the baseline is their median, 423.5; single
Refreshes 418 to 576. Then with two windows, five runs between 11:26 and 11:29 (load 12 to 100 per cent, free
memory 4.85 to 6.1 GB): 418.7, 428.5, 426.3, 560.8 and 499.3, median 428.5, the last two as the load rose. The
baseline stays 423.5: a baseline moves down only, and the two statistics read the same Refresh. S07's median of
five on 2026-09-28 read 416 to 476, median 437.7.

**Two speeds, not one.** The fifty single Refreshes of those runs fell at 418 to 457 ms or at 521 to 576, none between; in one of
the five runs all ten fell near 550. With git's trace on (below), at loads of 10 to 39 per
cent as at higher ones, a gap between two git processes ran about 105 ms longer than its neighbours up to three
times in a Refresh and not at all in others; that this is the second speed is an inference. It is not
attributed. Both speeds are inside the budget.

**Why two windows.** The fastest of ten in one window cannot get past a window whose every Refresh runs at
the slower speed. In ten runs at the one-window head on 2026-10-03 (10:47 to 11:01), one window's ten read 642
to 789 ms at a sampled load of 17 to 65 per cent, so its fastest, 641.8, was over the limit of 635.25 and
red. Two windows of five need both to be slow.

**Where a slow Refresh spends its time.** Timed with git's own trace, the processes' CPU time from Windows'
process table before and after each press, and the page's marks, eight Refreshes in one window on 2026-10-03 at a processor
load of 23 to 100 per cent (the trace itself adds about 25 ms to each git process): a Refresh is five git
processes run one after another. The three that took 615 to 723 ms spent 253 to 312 ms inside git's traced
runs, the log 117 to 151 of it, 268 to 309 in the gaps between the processes, and 68 to 75 from the press to the
first one; the five that took 871 to 1813 spent 300 to 779 inside git, the log 141 to 460, 455 to 746 in the
gaps, and 81 to 244 before the first. From the last git's exit to the rows painted — the layout of 10 000 rows,
two structured clones and the paint — took 23 to 53 ms in all eight. The slow ones spent what the fast ones did
not in starting and running git. Review round 20's 1.1 to 1.55 s Refreshes were not traced; that they spent it
the same way is an inference from these eight. Two things these instruments cannot
separate: the log's window holds the utility process's parse of git's output as it streams, so git's share
and the parser's are one figure; and a gap holds the utility's turn-around, Windows creating the process and
git's own start before its trace begins.

S06 measured the nearest thing it had, a Load More of 9 700 over the bridge without the paint, at 822 to 954 ms
on 2026-09-19. The same round trip measured 481 ms on 2026-09-28. S07 changed no product code, so the
difference is the machine or its condition on the two days; that is an inference, and neither day's condition
was measured.

### Parse and layout throughput

**How:** `perf/parse.perf.test.ts` reads the ten-thousand-commit fixture's log once from git, with the
adapter's own arguments, and times the parser feeding the store over it in 16 KiB chunks — smaller than any
chunk S03 saw arrive from the pipe, so it pays for more boundaries, not fewer. `perf/layout.perf.test.ts`
times `layoutPage` over 40 000 rows of a braided shape — for row *i*, a first parent at *i + 1 + r* with *r*
from 0 to 2, and every ninth row a second parent at *i + 1 + r* with *r* from 0 to 39, from a fixed
congruential sequence — implemented from S04's description, so its counters are this gate's own. Both take
the fastest of five runs after a warm-up.

**Both are held as time per commit, not commits per second.** A throughput is a lower bound and
`compareWithBaseline` fails a number that rises; 20 000 commits a second turned over is at most 50 µs a commit,
and 200 000 is at most 5 µs, so a slower parser raises the number exactly as every other regression in
`perf/baselines.json` does. Adding a second direction to the comparison was the alternative; it would have
been a new branch in the one function every gate trusts and a new way to read an entry the wrong way round.

Beside the time, two counters: **18.747 units of layout work a row** at 40 000 braided rows (18.746875 exactly),
and **3.965 times the work of 10 000 rows for 40 000** — about four, not sixteen. Both are identical on every
run and are held with no tolerance.

### Structural memory per commit

Not re-derived, as the task asked. `perf/store.perf.test.ts` ran unchanged at the lane's base and read
85.519, 79.828 and 76.416 bytes a commit at 12 502, 20 000 and 80 000 commits, each equal to its committed
baseline.

### Memory at 50 000 commits, and what closing gives back

**What the budget counts.** Decision 6 first budgeted the *resident* memory of all processes, which on Windows
is the sum of their working sets. **The owner ruled on 2026-10-03 that it counts the sum of the private bytes
of every process of the application**, and the ruling is recorded in
`docs/ADR-0002-architecture-and-performance.md` decision 6, amended that day. The limit is unchanged: 400 MB in
SI megabytes, 400 000 000 bytes.

**How:** `test/e2e/budgets-memory.spec.ts` opens a 50 000-commit fixture built by the committed generator,
loads all of it over the bridge, waits for the rows to be painted, asks the main process for its own process
identifier, and then reads every process descended from it out of Windows' process table (`Win32_Process`)
every few seconds until the load's memory has been given back (below): the main process, the GPU process, the
network service, the renderer and the utility process. The `PrivatePageCount` fields of the reading that meets
the rule are summed and held to the entry `privateBytesAt50000`. The process Playwright spawns is a `cmd.exe`
shim above the main process and is not counted.

**The load's memory comes back in steps, over about a minute.** As S07 built it the case waited ten seconds and
read. Review round 20 found the sum still falling then, in eight launches read to sixty seconds. E01-M01-FIX-28
measured it again on 2026-10-03 between 15:50 and 16:03, at the lane's base, with a driver outside the
repository that loads the fixture as the case does and reads the tree, with each process's command line, every
3.1 to 3.6 s for 120 s after the paint. Five launches, the processor load read with every reading at 13 to
100 per cent and free memory at 3.0 to 3.9 GB:

| process | private bytes given back | when, after the 50 000 rows were painted |
| --- | --- | --- |
| GPU | 9.3 to 10.1 MB, in two steps | by 10.6 s |
| renderer | 6.2 to 7.6 MB | between 23.1 and 30.4 s |
| utility (`repository.cjs`) | 15.3 to 16.6 MB | between 25.5 and 30.8 s |
| GPU, a third step | 4.6 MB | between 30.1 and 36.8 s |
| main | 1.5 to 1.8 MB | between 50.6 and 58.4 s |

The sum read 199.9 to 204.2 MB at the paint, 190.2 to 194.6 at ten seconds, 167.3 to 172.6 at thirty, 158.7 to
163.9 at sixty and 158.0 to 163.2 at 120; nothing moved by 1 MB between the main process's step and 120 s. The
review's three steps are in these five launches too, the renderer's and the utility's later and closer together
than the review's eight showed them, and the GPU's third and the main process's are steps its table does not
have. A reading at ten seconds is therefore a reading about a quarter of the way down, and the 31 to 32 MB
still to come is more than the 19 MB its tolerance allowed.

**The rule: read when the sum has stopped falling.** The case takes the first reading for which a reading at
least 40 s older exists, no reading since that older one is 1 MB or more below one before it, and every one of
them holds the same processes. Past 180 s after the paint it fails rather than reads. The window is 40 s
because the longest still stretch between two steps, the GPU's third to the main process's, was 15 to 20 s by
the nearest readings and at most 26 s between them, so the rule is not met inside one; 1 MB is under the
smallest step. A rise does not hold the rule back, so a leak reaches the budgets instead of the cap. Applied to
the five curves above, the rule is met 96.6 to 99.3 s after the paint, within 0.11 MB of the reading at 120 s.
A fixed wait of a hundred seconds would have read the same on these five; the rule was preferred because it
waits longer when a step comes late, which a clock cannot, and one run below did (124.4 s). A collection forced
through an instrument was not used: nothing of the test's reaches the utility or the GPU process.

**What the rule does not catch** is a step more than 40 s after the one before it. In 22 runs of the case on
2026-10-03 (eleven before the rule asked for the same processes; processor load 8 to 100 per cent, free memory
0.08 to 5.9 GB), the rule was met 68.7 to 124.4 s after the paint. In 20 the private sum then moved by −1.0 to
+0.5 MiB over the five idle minutes that follow. In two, both with a plant in the utility process and the
processor at 52 to 100 per cent, the GPU process gave back 3.1 and 4.3 MiB during those minutes. And the steps
do not all come in every launch: in the 18 unplanted runs among them the main process, the first of the tree,
read 38.2 to 39.5 MiB at the reading taken in thirteen and 40.7 to 41.4 in five, and in those five it stayed
there through the idle minutes. That is part of the spread the tolerance covers.

**It meets the budget, by more than half.** Five runs of the case on 2026-10-03, between 18:57 and 19:35, read
156 663 808, 154 775 552, 158 007 296, 161 611 776 and 157 372 416 bytes — 147.6 to 154.1 MiB, median 150.1 —
with the rule met 100.5, 124.4, 107.5, 97.0 and 109.5 s after the paint. The baseline is that median, with a
tolerance of 1.1, so a run fails above 173.1 MB or above the 400 MB ceiling. Four more in a second session,
between 20:14 and 20:42, read 156 360 704, 159 985 664, 157 081 600 and 156 618 752, met at 110.2, 99.4, 98.2
and 100.8 s. **The largest of the nine is 1.029 times their median**, 1.027 times the baseline. Nine earlier
runs that day, before the rule asked for the same processes, read 155 619 328 to 162 095 104. The machine was
not quiet for any of them: another project's gate and mutation runs were in the process table throughout, the
processor load sampled every five seconds read 28 to 100 per cent in the first session and 8 to 100 in the
second, and free memory 0.08 to 5.4 GB. The tolerance stays at 1.1 and is not tightened to the spread, for one
observed reason: in a run of a first version of the rule, the GPU process read 48.3 MiB at one reading and 39.9
a second later, and since a rise does not hold the rule back, such a reading can be the one taken. Added to
the largest reading that is 170.4 MB, which 1.1 holds and 1.05 would not; that it would happen so is an
inference from one sighting.

The baseline fell from 190 316 544, read at ten seconds, to 157 372 416: the limit a run is held to fell from
209.3 to 173.1 MB with it. At ten seconds the same sum read 175.6 to 184.3 MiB in five runs on 2026-10-03 and
186.1 to 192.1 on 2026-09-28.

**Which processes are counted.** Two things were found in the tree that are not the loaded application.

*A second GPU process, for a second or two.* 120 s after its GPU process starts, the main process starts
another: `electron.exe --type=gpu-process --disable-gpu-sandbox --use-gl=disabled` with the graphics card's
vendor, device and driver identifiers on its command line. Watched on 2026-10-03 from outside the application,
polling Windows' process table about every 1.3 s through 26 launches of the case: it was seen in 18, created
119.92 to 120.02 s after the first GPU process, with a working set of 13.8 to 100.2 MiB and 4.1 to 25.4 MiB of
private bytes at the poll that saw it, and gone at most 1.0 to 5.0 s after it was created; no other process
was ever started by the application. This is the sixth process review round 20 and E01-M01-S10 each met once;
that theirs was this one is an inference, and the review's persisted for a minute where none here outlived
5 s. It is the application's own, but it holds memory for those seconds only, whatever is loaded, and it falls
about when the rule is met: in one of five runs before the rule asked for the same processes, a reading taken
a second after the rule was met, 107 s after the paint, held it at 78.2 MiB of working set, and the idle ratio
that started from that reading read 0.837. So a reading that holds it is not taken: the rule waits until
40 s of readings hold the same processes, and the idle window opens on the reading that met the rule rather
than on a second one.

*Another program's processes.* Windows reuses process identifiers, and a process keeps the identifier of a
parent that has ended. In a sixth launch of the curve above, left out of its table, a process of the application was given
the identifier that Microsoft Edge's launcher had held before it ended, and `processTree` took in the sixteen
Edge processes that still named it as their parent: 21 processes and 1 097 MB instead of five and 200. The case
now drops from the tree any process created before the parent it names. `processTree` itself, in
`test/e2e/support/budgets.ts`, is unchanged; its one other use, in `test/e2e/budgets-start.spec.ts`, reads the
root process alone.

**The sum of the working sets is printed and held to nothing.** The five runs read at ten seconds on
2026-10-03 read 432.0 to 442.5 MiB of
working sets, 453 to 464 MB, over 400; on 2026-09-28 it read 441.7 to 455.2 MiB, and E01-M01-S10 read 430.4
to 435.6 MiB on 2026-10-02. It was kept out of `perf/baselines.json`, not given a tolerance, for this reason: a
working set is what the operating system has left resident, so it moves with how hard every other program on
the machine presses for memory. S10 read one window 33 to 36 MiB under its own series with 0.4 GB free, and
on 2026-10-03 the idle ratio below fell to 0.869 in the run that began with the least memory free. A tolerance
that held every reading of an unchanged product, whatever moment its baseline was taken at, would have to cover
at least the 455.2-over-430.4 spread of the three days, 1.06, and with S10's pressed reading taken off the
lowest, 455.2 over about 397, some 1.15: about 58 MiB, more than the 42 to 51 MB the whole 50 000-commit load
adds over an empty repository by S10's measurement. A limit that loose catches nothing the load could regress
by, and a tighter one fails on the machine's mood. The private bytes do not depend on what is resident, so they
are what is held; across the same five runs they moved from 175.6 to 184.3 MiB, 5 %, against 2.4 % for the
working sets, and that is inside their tolerance of 1.1 from either end.

**Shown failing, each limit and each part of the rule.** Every plant was in the working tree, rebuilt, never
committed, on 2026-10-03, with the case as it now is. With 250 MiB filled and held in the utility process as it
starts, the case read 421 789 696 bytes and failed as *past the budget of 400000000*, the ceiling's own
message. With 40 MiB held there it read 202 289 152 and failed as *regressed … from a baseline of 157372416*,
the baseline's. With 45 buffers of 2 MiB held there and one given back every six seconds, the sum fell from
281.5 MiB all the way to the cap and the case failed as *the memory had not settled at the cap* with no
reading taken. With those plants removed and the build redone, four runs read 156 360 704 to 159 985 664 and
passed. Last, with the main process starting a child that lives six seconds every twelve, and the fall
switched off in the working tree so that only the processes could hold the rule back, it failed at the cap the
same way. The entry has no `ciTolerance`, so the CI regime holds it to the same two limits.

**After the window closed**, none of the five processes was still running, so nothing was still resident; the
utility process's memory went back to the operating system with the process, which is the claim S06 made and
had not tested. The window is closed the way a person closes it — every window of the main process closed,
then up to thirty seconds for the main process to exit — and not with Playwright's own `close`, which calls
`app.quit` itself and would measure Playwright's way of ending the application instead of
`window-all-closed` in `src/app/main.ts`. What is still running is found by matching each process's
identifier **and** creation time, so that an identifier reused by another program is not mistaken for a
survivor. With that handler's `app.quit()` removed, three of the five processes were still running thirty
seconds later, 227.8 MiB of them, and the gate failed.

That reading is taken the moment the main process has exited or the thirty seconds are up, and on a busy
machine it is not always zero. In 32 runs of the case by E01-M01-FIX-28 on 2026-10-03 that reached it, with
another project's gate and mutation runs in the process table during every one of them, six read processes still
running: in two the main process had not exited in thirty seconds, and in four it had and one or two of its
children had not yet. In the one of those four that was watched from outside, with the processor at 100 per
cent, the network service and the utility process were gone 12.5 s after the main process. Nothing in this
part of the case was changed by E01-M01-FIX-28; it is raised in that task's audit.

### Five idle minutes after the load

Five real minutes, with the case's own timeout set to fit them. **They open on the reading that met the rule
of the section above**, not ten seconds after the paint as S07 had it, so that they measure the application at
rest and not the end of its load.

**Memory:** the ratio is the sum of the working sets five minutes after that reading over the sum at it. The
nine runs of 2026-10-03 described above read 1.006, 0.853, 1.002, 1.002 and 0.988, then 1.002, 1.002, 0.998
and 1.002. The baseline is the median of the first five, **1.002**: up by 0.2 %. In the seven that read 0.998
to 1.006 no process's working set moved by more than 3.0 MiB. In the run that read 0.988 the working sets fell
by 6.2 MiB while the private bytes rose by 0.1; in the one that read 0.853 they fell by 58.7 MiB, every process
but the main one losing 10 to 21, while the private bytes rose by 0.2, and the free memory sampled during that
run went down to 0.08 GB. The operating system taking resident pages back is what that looks like; it is an
inference.

With the window opening at ten seconds, S07 read 0.923 to 0.947 on 2026-09-28 and 0.869 to 0.952 on
2026-10-03, and put the fall down to the load's collections finishing, as an inference. The curve above
supports it: 31 to 32 MB came back after the tenth second, about 7 % of the working sets. **The baseline rose
from 0.931 to 1.002 because the method changed, not because the application grew**, and the limit a run is
held to did not move: it was and is the ceiling, 1.02, which the old baseline's own limit of 1.024 was already
above.

**How small a leak the window sees.** Review round 20 planted a leak in the utility process, a one-second
interval keeping 5 625 numbers, and under the ten-second window the ratio read 0.969: the load's release hid
it. E01-M01-FIX-28 planted it again on 2026-10-03, and larger ones, in the working tree, rebuilt, never
committed:

| numbers kept each second | the utility's working set grew by | the other four's moved by | ratio | verdict |
| --- | --- | --- | --- | --- |
| 5 625 (45 KB) | 13.7 MiB, 3.3 % of the sum | −9.0 MiB | 1.011 | green |
| 5 625 again | 11.7 MiB, 2.9 % | −7.3 MiB | 1.011 | green |
| 6 560 (52 KB) | 17.5 MiB, 4.3 % | −7.0 MiB | 1.026 | red, on the ceiling's message |
| 7 500 (60 KB) | 19.6 MiB, 4.8 % | +0.3 MiB | 1.049 | red |
| 7 500 again | 19.5 MiB, 4.8 % | +1.1 MiB | 1.050 | red |

The first and fourth rows ran before the rule asked for the same processes and read the start of the window
a second after the rule was met; the others ran on the case as it is. With the plants removed, the four runs
of the second session above passed.

**So the window now sees a leak, and sees it from about twice its budget, not from the budget.** The plant the
review used no longer reads as shrinkage, and it still passes: in both of its runs the working sets of the
other four processes fell by 7 to 9 MiB, about 2 % of the sum, while their private bytes stayed within 0.4 MiB.
The same fall happened with nothing planted, in three of the 18 unplanted runs of that day (−6.2, −7.2 and
−7.7 MiB, ratios 0.981 to 0.988), and in a fourth by 58.7. A ratio of working sets therefore carries, from the
operating system alone, a movement as large as the 2 % it is held to, and in one direction: down. It cannot
fail an application that does not leak for that reason, and it can pass one that leaks by 3 %. Over the same
18 runs the sum of the private bytes moved by −1.0 to +0.5 MiB across the window, under 0.7 %. Decision 6 as
amended on 2026-10-03 keeps this row on the working sets, so which sum it should read is the owner's question,
raised by E01-M01-FIX-28 and not answered here.

**CPU:** as S07 measured it on 2026-09-28, the five processes used 187 ms of processor time in 300 s,
**0.063 % of one core**, read from Windows' per-process kernel and user times; the second run read 0.063 % as
well, the third **0.453 %**, the fourth 0.099 % and the fifth 0.156 %. Of the third run's time, 1 110 ms was
the main process alone, while the main-process count below saw no Node callback at all in that run, so the
time went to something in Chromium's side of the main process that this gate cannot name. **Wakeups:** none. In the page,
the init scripts count every callback of `setTimeout`, `setInterval`, `requestAnimationFrame` and
`requestIdleCallback`, wrapped before `renderer.js` runs, and none ran; nor did the canvas redraw. In the main
process an `async_hooks` hook counts every callback Node runs — a timer, an immediate, a socket, a message —
and none ran either, once the two reads of the count itself are subtracted. That held in all five runs.

The nine runs of 2026-10-03 on the case as it now is read processor time of 0.177, 0.099, 0.078, 0.109 and
0.089, then 0.099, 0.104, 0.182 and 0.125 % of one core, and zero wakeups in the page and the main process in
every run. Their window opens at the settled reading, before the counters are installed, so it holds three
calls into the application that S07's did not; the readings are not told apart from S07's by that, and the
entry `idleCpuPerCent` is unchanged.

Before that, with the window still opening at ten seconds, the five runs of the case on 2026-10-03, on the
loaded machine described at the top, read idle ratios of 0.869,
0.952, 0.942, 0.922 and 0.924, processor time of 0.099, 0.104, 0.156, 0.094 and 0.115 % of one core, and zero
wakeups in the page and the main process in every run. The 0.869 came from the run that began with 1.17 GB free
and ended with 0.79: a working set trimmed by the operating system is what that looks like, an inference the
ratio cannot itself confirm.

What these cannot see is work Chromium schedules for itself outside JavaScript, such as a garbage collection
or a compositor task, and the utility process, where nothing of the gate's can run; the processor times cover
both.

"≈ 0 %" is not a number, so the gate needs one. It holds the figure to **0.5 % of one core** — below it, the
figure rounds to zero per cent — and the wakeups to exactly zero. Its tolerance is 8, which puts the baseline's
own limit at 0.504, just above the ceiling, so that the strict limit is the ceiling: the five runs show the
figure moving by seven times between runs of an unchanged product, and a tolerance sized to 0.063 would fail
the third. **The third run's 0.453 % is close enough to 0.5 that this gate may flap**, and a flapping gate is
a defect of the gate; it is raised with the owner rather than widened here.

### Main-thread work per frame while scrolling

**How:** `sampleScrollFrames` in `test/e2e/support/budgets-page.ts` scrolls the list once a frame from the first
animation-frame callback of each rendering update, and posts a message from it; a message is a task, and no
task runs until the update — the renderer's `paint`, then style, layout, paint and the hand-over to the
compositor — has finished, so the message's arrival is the end of the frame's main-thread work. Each timed
frame therefore holds one scroll, one repaint of the rows and the canvas, and all the rendering between.
What it leaves out is the scroll listener, which only asks for a frame, and anything off the main thread.

Two scrolls of 240 frames, five runs each, over the ten-thousand-commit fixture: 72 pixels a frame read means
of 2.69 to 2.90 ms and worst frames of 5.1 to 7.3 ms; **1 200 pixels a frame**, more than the whole pool, so
that every frame rewrites every row element, read means of 5.13 to 5.34 ms and worst frames of 7.3 to 8.1 ms.
The budget is held on the second, the most a frame of this view can be asked to do, as the median of the five
runs' means and the median of their worst frames. The fixture is a straight chain, one lane wide; a braided
history draws more lines a row, and this reading does not include one.

### Live row elements

37 row elements with 300 commits loaded, and 37 with 10 000 loaded after scrolling to four offsets across the
whole list. The viewport of the 1280 × 800 window is 669 pixels high, which is 29 visible rows, and twice the
overscan of 4 makes the bound 37: the pool is exactly at its budget, which is what `rowPoolSize` in
`src/ui/geometry.ts` is written to produce. The ratio of the two counts is held at 1.

## The counters

Deterministic figures of `docs/ADR-0003-quality-gates-and-ci.md` decision 4, held with no tolerance unless one
is named:

| counter | baseline | how |
| --- | --- | --- |
| canvas redraws per scrolled frame | 1 | 120 redraws for 120 frames of a scripted scroll |
| canvas redraws for 25 scroll events in one task | 1 | the view's own coalescing, with the events dispatched |
| git processes to open a repository | 6 | `git --version` to find git, then rev-parse, log, for-each-ref, stash and status |
| git processes per Refresh | 5 | the same five |
| git processes per Load More | 5 | worst of five presses |
| commits read by the fifth Load More over the first | 3 | 1 800 over 600 |
| heap bytes allocated parsing a commit | 3 168.776, tolerance 1.001 | see *Allocation* |
| typed-array bytes allocated parsing a commit | 66.64 | the store's columns |
| heap bytes allocated laying out a row | 13.512, tolerance 1.01 | |
| typed-array bytes allocated laying out a row | 130.491 | the layout's output and segment buffer |

**Git processes are counted by git.** `GIT_TRACE2_EVENT`, set to a file in the application's environment,
makes every git process append a `start` event as it begins; `src/adapters/git-process.ts` passes the
environment on apart from the seven variables that redirect a repository, and the utility process inherits the
main process's, so nothing in the product is touched.

**The per-press cost of Load More, as a ratio.** S06's item 3. The utility process reads the whole page again
at every press, so the *n*th press parses and stores *n + 1* pages; each reply's `commits.count` says how many
it stored — 600, 900, 1 200, 1 500, 1 800 — and the fifth over the first is 3, which no machine can move. A
reader that could start at an offset would bring it to 1 and the gate would report that as an improvement to
commit. The five presses took 537 to 600 ms each on this run, flat, which agrees with S06's reading that the
fixed cost of a press dominates at these sizes.

### Allocation

**It could be measured deterministically, nearly.** Node has no allocation counter, and a collection inside a
measurement subtracts from the heap's growth. `perf/allocation.perf.test.ts` removes the collection rather than
estimating around it: it bundles the parse and the layout with esbuild into a child Node process started with
`--expose-gc`, `--predictable` and a 256 MiB young generation, collects before each run, and reads the heap's
growth across the third run — `--trace-gc` on the same program printed only the collections it asked for. Five
processes read the parse at 3 168.7272 to 3 168.776 heap bytes a commit and the layout at 13.4814 to 13.5118 a
row: a residue `--predictable` does not remove, which the two tolerances cover four times over while still
failing one more small object per unit. The typed-array figures were identical in all five.

**3 169 heap bytes a commit is worth a reader's attention.** The store keeps under 96 bytes a commit and the
parser allocates thirty-three times that on the way, most of it — an inference from the parser's code, not a
measurement — the strings it decodes for every name, e-mail and subject before the store interns them. No
budget covers it; the baseline now does, so it cannot grow unseen.

What allocation this does not see is the renderer's: the switches are not the gate's to set inside Chromium, so
the frame budget is what holds that path.

## Where each baseline lives, and what reads it

Every figure above is an entry of `perf/baselines.json`, in the shape the file already had — `baseline`, an
optional `ceiling`, an optional `tolerance`, a `unit` that says what was measured and how — plus one new
optional field, `ciTolerance` (next section). Every ceiling is decision 6's budget, unchanged; every baseline
is what was measured on 2026-09-28 — the private memory at 50 000 commits on 2026-10-03 — not a round target.

| gate | files | entries | the line that reaches `compareWithBaseline` |
| --- | --- | --- | --- |
| `gates:perf` | `perf/parse.perf.test.ts` | `parseMicrosecondsPerCommit` | its `compareInRegime` call |
| `gates:perf` | `perf/layout.perf.test.ts` | `layoutMicrosecondsPerCommit`, `layoutWorkPerRow`, `layoutScalingRatio` | `compareInRegime` in its `held` |
| `gates:perf` | `perf/allocation.perf.test.ts` | the four allocation entries | `compareInRegime` in its `held` |
| `gates:e2e` | `test/e2e/budgets-start.spec.ts`, `budgets-frames.spec.ts`, `budgets-git.spec.ts`, `budgets-memory.spec.ts` | every other new entry | `compareInRegime` in `holdToBaseline`, `test/e2e/support/budgets.ts` |

`compareInRegime`, in `perf/baselines.ts`, applies the regime's limits and calls `compareWithBaseline`, which is
unchanged. Every case asserts on the verdict it gets back, and a case that holds several budgets makes every
comparison before it asserts, so one red budget does not hide another's verdict.

## Two regimes: strict here, wide in CI

`docs/ADR-0003-quality-gates-and-ci.md` decision 4 checks the wall-clock budgets strictly on the development
machine and with a wide tolerance in CI, so that only an order-of-magnitude regression fails there.

**How a run knows.** `regimeOf` reads the `CI` variable, which GitHub Actions sets to `true` in every job and
nothing on the development machine sets; empty, `0` or `false` is the strict regime. It is the runner declaring
itself, so nothing in the workflow file has to pass a flag, and the failure it can have is one-sided: a runner
that did not set it would be held strictly and go red, which is seen. Every verdict is printed with the regime
it was held to.

**How wide.** An entry with a `ciTolerance` has every limit multiplied by it in CI — the ceiling and the
baseline's own tolerance — and nothing removed. Every wall-clock entry carries a tolerance of 1.5, applied to a
median of five, to the fastest of five or to the fastest of ten, never to one run. The two cold starts and the
load are the fastest of ten since E01-M01-FIX-27 (2026-10-03), because their median of five went red in seven
runs of ten on an unchanged product on a shared machine (under *Cold start, empty repository*); in those
ten runs single cold starts read 968 to 3351 ms, and in the five runs that set today's baselines the fastest
of ten sat 958 to 1100. Each also carries a `ciTolerance` of 4, so that in CI a
figure may be six times its baseline, or four times its budget, whichever is less. Six because it has to be
**under ten**, or a regression of an order of magnitude would pass on the runner, with room for a fast run to
still fail at ten; and as far above one as that allows, because the runner is a different machine: no run of
either job has happened (the task file records that `origin` carries only the scaffold commit, checked
2026-09-28; this lane touched no remote and did not check it), the runner has no
GPU, so its frames are drawn in software, and it builds its fixtures cold. That the runner is less than about
three times slower than this machine is an inference, and the first CI run is where it is tested.

The idle processor figure carries a tolerance of 4 and a `ciTolerance` of 4, because it is a time too; the
memory figures carry a tolerance and no `ciTolerance`, because the budget is about the product and not about
the machine.

**Shown failing, both ways.** A regression planted at about ten times the measured cost — a busy-wait at the
start of the renderer, in the utility process's Refresh, in the renderer's `paint`, in the parser and in the
layout pass, which read 7.2 to 10.8 times each figure's baseline — failed every wall-clock gate in both
regimes. A regression planted at about three times — 2.7 to 3.1 times — failed every one in the strict regime
and passed every one in the CI regime. Removing the plants turned every one green in both.

E01-M01-FIX-27 planted again, on 2026-10-03, against the fastest of ten and the re-measured baselines. A
busy-wait of 850 ms in the utility process's Refresh made the fastest of ten Refreshes, five in each of two
windows, 1262.1 ms (2.98 times the baseline of 423.5): red in the strict regime, past the 800 ms budget, and
1258.8 ms and green in the CI regime, whose limit is 2541. One of 3900 ms made it 4311.6 strict and 4308.2 CI:
red in both, past 800 and past 3200. With all ten in one window the same plants read 1249.9 and 1374.5, and
4530.3 and 4309.4, with the same verdicts.
A busy-wait of 700 ms at the start of the renderer made the fastest of ten empty cold starts 1685 ms: red, past
1500. Removing each plant and rebuilding turned it green.

## The size budgets, calibrated

`npm run gates:size` weighed the production build on 2026-09-28, at the lane's base and again at its head:
renderer.js 10 942 bytes, renderer.css 4 280, main.cjs 3 969, repository.cjs 27 367. The margin rule
`scripts/gates/size-budget.json` states — measured plus one kibibyte, rounded up to the next whole kibibyte —
gives 12 288, 6 144, 5 120 and 28 672: each budget's existing number. **No budget moved**, the total moved by the
sum of the movements, which is zero, and stays 54 272, and the "initial" label is gone from all four; the file's
new `comment-e01-m01-s07` records the measurement.

One build change would lower one of them, and was not made: renderer.css is copied rather than minified, so its
comments ship. Without them it is 3 588 bytes, and the rule would give it 5 120, a kibibyte under today's
budget. That is a change to `scripts/build.js`, which this slice could not touch.

## The golden-image question: settled, yes

**Byte-stable on this machine.** Two fixtures — `branch-and-merge`, which has a merge and a second lane, and the
ten-thousand-commit chain — were each opened in five separate launches of the built application at the
application's own 1280 × 800, and the graph canvas was read back with `getImageData` and the window captured by
Playwright's screenshot. With the GPU: the canvas was 64 × 669 pixels, and its bytes, and the screenshot's
bytes, were identical in all five launches of each fixture. With `--disable-gpu`, the same: identical in all
five, with different bytes from the GPU's, as expected of a different rasteriser. Nothing differed within a mode.

**So there is a golden image.** `test/e2e/golden-graph.spec.ts` opens `branch-and-merge` with `--disable-gpu`,
sets the window's content to 960 × 600, and compares the canvas's unpremultiplied RGBA, byte for byte, with
`test/e2e/golden/graph-branch-and-merge.rgba.deflate`, which `.gitattributes` marks binary. It passed five runs
of five after the image was recorded. A mismatch writes what was drawn under `test-results/golden/`.

**What it will do on `windows-latest`, as an inference.** Software rendering is chosen because the runner has no
GPU and will rasterise in software whatever the switch says, and the window is set smaller than the
application's own size because the runner's screen may be smaller than 1280 × 800. With both of those equal,
the image depends on Skia's software rasteriser drawing the same pixels from the same commands on two x86-64
processors. It selects its vector code by the processor's features at run time, so a runner with a different
instruction set may round an anti-aliased edge by one step differently. I expect it to hold, and do not know
that it will; the case is not skipped or weakened anywhere, so if it does not hold, the first CI run says so,
and the repair is the owner's choice between a per-platform image and a tolerance.

## How each reading could be wrong, and how that was checked

- **A "painted" mark earlier than the paint.** It happened, and the mark was corrected by E01-M01-FIX-27. As
  S07 built it, a mark read the window and took the time in the second of two nested animation-frame
  callbacks, which cannot run until the update after the change has painted — but the window it read could
  hold a change made after that paint. On 2026-10-03, in 140 cold starts of that probe at a processor load of
  37 to 100 per cent, three first marks came before Chromium's `paintTime` for the first contentful paint: two
  by about 29 ms, where the first mark showed the page before the renderer had mounted anything, whose paint
  is Chromium's *first* paint, and one by 1.9 ms, where the renderer mounted its bar between the two callbacks
  and the mark showed the bar before it was painted. Review round 20 met one of these, by 1.7 ms. **A mark now
  reads the window in the first callback**, in the update whose paint draws what it read, and takes the time in
  the second; and every cold start holds its first mark to be no earlier than Chromium's first paint and its
  first mark showing the bar to be no earlier than the first contentful paint. In 120 cold starts on 2026-10-03
  (load 11 to 80 per cent) that mark came 1.6 to 43.4 ms after Chromium's paint of the bar, and the frame
  reached the screen 36 to 132 ms after that paint. Planted, a mark taking the time in the first callback failed
  the first-paint check in the first launch, and with that check removed the bar check failed alone. The mark
  is therefore after the main thread painted what it shows and may be before the compositor presented it.
- **A probe installed too late.** Each init script records whether the renderer's view already existed; every
  launch requires all five to say no.
- **A memory reading that misses a process, or counts one that is not the loaded application.** The tree is
  read from the operating system, rooted at the pid the main process reports, and must hold at least four
  processes. It held five in every reading taken; a sixth of the application's own lives for a few seconds two
  minutes after the start, and once another program's processes were in the tree by a reused identifier, and
  the case now takes neither (under *Memory at 50 000 commits*).
- **A memory reading taken while the load's memory is still coming back.** It was, at ten seconds. The case now
  reads when the private sum has not fallen by 1 MB in 40 s, and fails past 180 s rather than read; a step more
  than 40 s after the one before it is what that still misses.
- **An idle window whose wakeups the count cannot see.** Chromium's own work and the utility process are out of
  the counters' reach; the processor times of all five processes are what cover them.
- **A memory reading that reads the wrong field.** The sum held is `PrivatePageCount`, which Windows' process
  table gives in bytes; a planted 250 MiB held in one process raised it by 252.2 to 260.9 MiB against the five
  unplanted runs, which is that allocation and the bytes the plant itself costs to run, so the field counts
  what a process commits for itself.
- **A ceiling nobody can reach.** Every gate was watched failing on a planted regression (above), the memory
  ceiling of 400 MB included.

## What is not here

- **A gate on the sum of the working sets.** It is printed by the memory case and held to nothing, for the
  reason given under *Memory at 50 000 commits*; it read 451 to 477 MB across three days, over 400, and
  decision 6 as amended does not hold it.
- **Shipping renderer.css without its comments**, which would lower its budget by a kibibyte, is a build change
  for a later task.
- **A braided history in the frame and memory readings.** The fixtures are a straight chain; the committed
  generator has no large braided shape, and `test/e2e/support/fixtures.ts` was outside this boundary.
- **The renderer's allocation**, which this slice could not count deterministically inside Chromium.
