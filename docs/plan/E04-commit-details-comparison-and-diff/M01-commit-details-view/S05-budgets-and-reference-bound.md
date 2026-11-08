# E04-M01-S05 · Budgets and the reference bound

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S05 budgets and the
reference bound

Gate work, nothing in the window changed. The scrolled case of `test/e2e/budgets-frames.spec.ts` now holds
`docs/ADR-0002-architecture-and-performance.md`'s "no frame over 16.7 ms" literally, and discards a reading the
machine made blind instead of passing it; `launchBudgeted` in `test/e2e/support/budgets.ts` gets all five init
scripts into the first window by construction and launches on a user-data directory of its own; the count cases
read their counts once the page is quiet instead of after fixed waits. It takes the items 22, 29, 41 and 42 and
item 4's part in `budgets.ts` that E03-M01's reviews carried into this milestone (`docs/PLAN.md`). It has no
reference behaviour of Git Graph.

## What the budgets gate prints now

`npm run gates:budgets` keeps its command and its exit codes. The scrolled case, *main-thread work per frame while
scrolling*, prints two new kinds of line after its two lines of figures:

- **The reading's standing**, one line, before the verdicts. Either
  `kept reading: the reference's 2400 timings have a 95th percentile of 3.2 ms, against a bound of 4 ms`, or
  `DISCARDED reading: the reference's 2400 timings have a 95th percentile of 5.9 ms, against a bound of 4 ms: the
  machine slowed the reference past where these verdicts tell a regression from its load, so none is held; read the
  case again on a quieter machine`.
- **A third verdict**, `scrollFrameLongestMilliseconds`: `ok`, `FAIL` or, on a discarded reading, `DISCARDED`,
  followed by `[strict regime] longest main-thread frame, as timed, of the run where it is shortest is …`.

On a discarded reading all three verdicts print `DISCARDED` in place of `ok` or `FAIL` and none is asserted, so
Playwright counts the case as passed and adds an annotation of type `discarded` carrying the percentile. The line
is the record; a reader of the gate's output reads it.

`launchBudgeted` prints `the first document holds init scripts […]: reloaded` when it reloads a first window, and
the start cases print `that launch was reloaded, so it is not timed: launched again` when they set such a launch
aside. Neither appeared in any run this lane read outside its own probe.

## No frame over 16.7 ms, held literally

Item 29 and the owner's ruling of 2026-10-28. The new verdict takes each of the ten held runs of the 1 200 px
scroll (240 frames each, a second apart), its longest frame **as timed**, not divided by the reference, and holds
the lowest of the ten to `scrollFrameLongestMilliseconds` in `perf/baselines.json`: baseline 16.7, ceiling 16.7,
tolerance 1, so the limit on the development machine is 16.7 exactly. The number is the ADR's, one frame at
60 Hz, and not a measurement: `AGENTS.md` §11's path for relaxing a flapping threshold does not apply to it, and
the entry's `unit` says only a change of the ADR moves it. Its `ciTolerance` is 4 like every timed entry's, so a
CI runner holds it to 66.8 ms (`perf/baselines.ts`, `limitsIn`).

**Why the lowest of the ten runs' longest frame.** A load slows some runs and not others; a regression of the
product that makes one frame in 240 slow does so in every run. Held this way the verdict is red when every one of
the ten runs has a frame over 16.7 ms. The case already holds its other two verdicts as the lowest of ten, for the
reason its comment gives. What this does not see is a slow frame the product makes in some runs only; one run held
alone (the first, say) would see it, and would be red whenever a load burst met that run. Which frames run slow
under load is in the readings below: under three busy threads the unchanged product had a frame over 16.7 ms in
every run of a reading whose reference median was 2.4 ms.

**What it read.** On a quiet machine (other load 7.9 to 24.3 per cent), the unchanged product: 6.7, 6.8, 7.0, 7.4
and 8.0 ms. A busy-wait of 20 ms planted in every 240th call of the view's `paint`, one frame a run: 24.8 and 24.5,
red, with the two per-reference verdicts green (5.04 and 5.07, 6.1 and 6.2). The line it hinges on is the third
`holdToBaseline` call of the scrolled case, `Math.min(...jumping.worsts)` against `scrollFrameLongestMilliseconds`,
and `worsts.push(Math.max(...sample.work))` in `framesAt`.

## A reading the machine made blind is discarded

Item 41. E03-M01-FIX-05 measured a game at 32.7 and 34.0 per cent other load, free under §11, under which a 5 ms
busy-wait read green: the per-reference verdicts divide every frame by a layout workload, and that load slowed the
workload more than it slowed a fixed wait.

### The rule

For the paragraph the orchestrator writes into `AGENTS.md` §11: **a reading of the scrolled case is discarded,
whatever its verdicts, when the 95th percentile of its 2 400 reference timings is over 4 ms.** The reference is the
fixed layout workload `sampleScrollFrames` times straight after every frame of the ten held runs; the percentile is
the 2 281st of the timings in ascending order, `REFERENCE_BOUND_MILLISECONDS` and `REFERENCE_BOUND_SHARE` in
`test/e2e/budgets-frames.spec.ts`. A discarded reading is recorded with its percentile as discarded and the case is
read again on a quieter machine, exactly as a reading over §11's load limits is; it is neither red nor green. The
bound stacks on §11 and does not replace it: a reading must be free by §11 **and** inside the bound to count.

### How the readings were taken

All on 2026-11-06, between 21:12 and 23:50 local time, on the development machine (Intel i5-10310U, four cores and
eight threads, its integrated graphics processor). Each reading was the scrolled case alone,
`npx playwright test test/e2e/budgets-frames.spec.ts --project=budgets -g main-thread`, run inside a Windows job
object, with the whole machine's busy share read from its idle, kernel and user times every second and the job's
own processor time from the job's accounting, so the other load is the difference; the job's process list, read
every fifteen seconds with each process's id and start time, held `cmd`, `conhost`, `node` and `electron` and
nothing else (`git` processes live between two samples). Each was judged by §11: other load under 40 per cent on
average over the minute before and over the reading, no two-second block over 75. Before each, the lane waited
until no other process's command line named a gate of this project, and none did. A planted regression was written
at the top of `paint` in `src/ui/graph-table.ts`, built, read, and the file restored from git and built again after.

The readings before 22:57 were taken at the lane's working tree before its commit `701c337`: the same verdicts and
the same figures, with a draft bound on the median of the runs' reference middles. From 22:12 the timings of every
frame were saved, so their 95th percentile is known; before that it is known only where the median puts it over
4 ms (at least half the runs over 4 ms puts at least a quarter of the timings over it). The readings marked *head*
were taken at `701c337`, which prints the percentile.

### The loads

Each started ten seconds before the minute the reading is judged on, so that minute carries it, and stopped after
the reading; its share is the other load in the table.

- **2 or 3 busy threads:** Node worker threads, each spinning on integer arithmetic for 90 per cent of every
  50 ms. Bound by the processor.
- **1 or 2 memory-copy threads:** the same duty, each copying between two 64 MiB arrays, far past the 6 MiB
  cache, so bound by memory bandwidth.
- **Shader:** an Electron window of 640 by 400 pixels redrawing a fragment shader of 3 000 iterations every frame.
  Alone it held the graphics processor's 3D engine at 99 per cent (its own counter, read once) at about 2 per
  cent of the processor.
- **Shader and 1 or 2 busy threads:** both at once. Neither alone slowed the reference; together they did, which
  is consistent with the processor and graphics processor sharing one power budget, an inference not measured.

### Every reading, and which side of the bound it fell

*Mean* and *fifth* are the two per-reference verdicts (limits 7.41 and 10.0365), *longest* the literal one (limit
16.7). *Outcome* applies the committed bound to each reading.

| reading | load | plant | other % before / during | §11 | reference median | 95th percentile | mean per ref. | fifth per ref. | longest | outcome under the bound |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 21:12 | none | none | 13.4 / 24.3 | kept | 2.6 | not saved | 4.70 | 6.2 | 8 | green; percentile not saved |
| 21:15 | none | none | 12.1 / 8.1 | kept | 2.4 | not saved | 4.99 | 6 | 6.8 | green; percentile not saved |
| 21:20 | none | 5 ms every frame | 11.1 / 7.4 | kept | 2.3 | not saved | 9.76 | 11.4 | 11.7 | red (mean, fifth); percentile not saved |
| 21:23 | none | 5 ms every frame | 10.4 / 7.0 | kept | 2.3 | not saved | 9.77 | 11.6 | 15.4 | red (mean, fifth); percentile not saved |
| 21:26 | 2 busy threads | 5 ms every frame | 23.1 / 25.5 | kept | 2.2 | not saved | 8.74 | 11.5 | 11.6 | red (mean, fifth); percentile not saved |
| 21:29 | 2 busy threads | 5 ms every frame | 27.2 / 25.5 | kept | 2.2 | not saved | 9.32 | 11.7 | 18.1 | red (mean, fifth, longest); percentile not saved |
| 21:32 | 2 memory-copy threads | 5 ms every frame | 35.2 / 36.5 | kept | 5.3 | not saved | 6.73 | 9.7 | 26.4 | discarded (median over 4); red (longest) without the bound |
| 21:35 | 2 memory-copy threads | 5 ms every frame | 33.9 / 37.3 | kept | 5.5 | not saved | 6.66 | 9.5 | 25.1 | discarded (median over 4); red (longest) without the bound |
| 21:38 | shader | 5 ms every frame | 10.8 / 7.9 | kept | 2.3 | not saved | 9.80 | 12.8 | 15.8 | red (mean, fifth); percentile not saved |
| 21:41 | shader | 5 ms every frame | 10.6 / 8.3 | kept | 2.3 | not saved | 9.43 | 12.8 | 15.1 | red (mean, fifth); percentile not saved |
| 21:44 | shader and 2 busy threads | 5 ms every frame | 24.3 / 32.3 | kept | 6.2 | not saved | 6.29 | 8.9 | 25.9 | discarded (median over 4); red (longest) without the bound |
| 21:47 | shader and 2 busy threads | 5 ms every frame | 24.4 / 29.2 | kept | 6.1 | not saved | 6.44 | 8.7 | 24.8 | discarded (median over 4); red (longest) without the bound |
| 21:50 | 2 busy threads | none | 22.7 / 24.9 | kept | 2.3 | not saved | 5.26 | 7.4 | 16.2 | green; percentile not saved |
| 21:53 | 2 busy threads | none | 22.6 / 23.6 | kept | 2.3 | not saved | 5.67 | 7.8 | 15.7 | green; percentile not saved |
| 21:56 | 2 memory-copy threads | none | 35.4 / 39.4 | kept | 5.5 | not saved | 4.95 | 7.3 | 21.8 | discarded (median over 4); red (longest) without the bound |
| 21:59 | 2 memory-copy threads | none | 40.3 / 36.2 | discarded | 5.7 | not saved | 4.89 | 7.1 | 22.6 | discarded (median over 4); red (longest) without the bound |
| 22:02 | shader | none | 11.5 / 8.4 | kept | 2.4 | not saved | 5.03 | 7.4 | 8.3 | green; percentile not saved |
| 22:05 | shader and 2 busy threads | none | 23.9 / 31.8 | kept | 6.3 | not saved | 4.53 | 6.7 | 20.7 | discarded (median over 4); red (longest) without the bound |
| 22:08 | shader and 2 busy threads | none | 24.3 / 27.9 | kept | 6 | not saved | 4.69 | 6.7 | 14.9 | discarded (median over 4); green without the bound |
| 22:12 | none | none | 10.7 / 8.1 | kept | 2.4 | 3.3 | 4.94 | 6 | 7.4 | kept: green |
| 22:15 | 2 busy threads | none | 23.9 / 25.2 | kept | 2.3 | 3.4 | 4.58 | 6.1 | 7.9 | kept: green |
| 22:18 | 2 busy threads | none | 22.6 / 24.4 | kept | 2.3 | 4.1 | 5.61 | 7.9 | 15.6 | discarded; green without the bound |
| 22:21 | 2 busy threads | none | 26.0 / 24.1 | kept | 2.3 | 4.1 | 5.32 | 7.5 | 14.3 | discarded; green without the bound |
| 22:23 | 3 busy threads | none | 31.8 / 33.0 | kept | 2.3 | 3.3 | 4.42 | 6 | 6.6 | kept: green |
| 22:26 | 3 busy threads | none | 32.7 / 35.4 | kept | 2.4 | 5.9 | 5.90 | 8 | 20 | discarded; red (longest) without the bound |
| 22:29 | 1 memory-copy thread | none | 21.9 / 27.8 | kept | 3.5 | 6.2 | 5.26 | 8.2 | 14.2 | discarded; green without the bound |
| 22:32 | 1 memory-copy thread | none | 18.9 / 23.1 | kept | 3.5 | 5.1 | 4.79 | 7.6 | 12.9 | discarded; green without the bound |
| 22:35 | 1 memory-copy thread | 5 ms every frame | 17.6 / 21.9 | kept | 3.6 | 5.9 | 7.81 | 10.5 | 18.2 | discarded; red (mean, fifth, longest) without the bound |
| 22:38 | 1 memory-copy thread | 5 ms every frame | 18.9 / 22.1 | kept | 3.5 | 5.8 | 7.74 | 10.7 | 18.2 | discarded; red (mean, fifth, longest) without the bound |
| 22:41 | shader and 1 busy thread | 5 ms every frame | 16.6 / 18.9 | kept | 5.5 | 7.9 | 6.69 | 8.9 | 14.1 | discarded; green without the bound |
| 22:44 | shader and 1 busy thread | 5 ms every frame | 15.1 / 18.7 | kept | 3.5 | 7.0 | 6.84 | 8.8 | 16.5 | discarded; green without the bound |
| 22:47 | shader and 1 busy thread | none | 15.0 / 20.0 | kept | 5.6 | 8.9 | 4.77 | 6.8 | 18.8 | discarded; red (longest) without the bound |
| 22:50 | none | 20 ms every 240th | 10.2 / 9.5 | kept | 2.5 | 3.4 | 5.04 | 6.1 | 24.8 | kept: red (longest) |
| head 22:57 | none | none | 11.9 / 7.9 | kept | 2.5 | 3.2 | 4.97 | 6.1 | 7 | kept: green |
| head 23:00 | none | none | 11.4 / 8.0 | kept | 2.4 | 3.2 | 4.94 | 6 | 6.7 | kept: green |
| head 23:03 | none | 5 ms every frame | 12.4 / 7.7 | kept | 2.3 | 3.1 | 9.85 | 11.5 | 12.5 | kept: red (mean, fifth) |
| head 23:06 | none | 20 ms every 240th | 11.7 / 12.7 | kept | 2.4 | 3.5 | 5.07 | 6.2 | 24.5 | kept: red (longest) |
| head 23:09 | 2 busy threads | none | 23.1 / 24.5 | kept | 2.2 | 4.2 | 5.74 | 7.8 | 14.5 | discarded; green without the bound |
| head 23:11 | 2 busy threads | none | 23.6 / 24.4 | kept | 2.3 | 3.3 | 4.32 | 6.1 | 7.5 | kept: green |
| head 23:14 | 2 busy threads | 5 ms every frame | 24.3 / 24.2 | kept | 2.2 | 3.8 | 9.93 | 12.4 | 17.7 | kept: red (mean, fifth, longest) |
| head 23:17 | 3 busy threads | none | 33.7 / 32.8 | kept | 2.3 | 3.3 | 4.40 | 6.2 | 8 | kept: green |
| head 23:20 | 3 busy threads | none | 32.1 / 34.8 | kept | 2.4 | 5.9 | 5.75 | 8.2 | 20.4 | discarded; red (longest) without the bound |
| head 23:23 | 3 busy threads | 5 ms every frame | 32.3 / 32.7 | kept | 2.2 | 3.1 | 9.17 | 12 | 11.8 | kept: red (mean, fifth) |
| head 23:26 | 2 memory-copy threads | 5 ms every frame | 33.7 / 40.5 | discarded | 5.6 | 10.2 | 6.52 | 9.3 | 24.9 | discarded; red (longest) without the bound |
| head 23:29 | 1 memory-copy thread | 5 ms every frame | 19.3 / 23.4 | kept | 3.6 | 6.2 | 7.80 | 10.6 | 18.5 | discarded; red (mean, fifth, longest) without the bound |
| head 23:32 | shader | 5 ms every frame | 11.5 / 8.4 | kept | 2.3 | 3.8 | 9.69 | 12.5 | 12.9 | kept: red (mean, fifth) |
| head 23:35 | shader and 2 busy threads | 5 ms every frame | 23.9 / 29.8 | kept | 6.2 | 9.2 | 6.43 | 8.8 | 24.7 | discarded; red (longest) without the bound |
| head 23:38 | shader and 1 busy thread | 5 ms every frame | 15.1 / 19.3 | kept | 5.6 | 8.3 | 6.66 | 8.6 | 15 | discarded; green without the bound |
| head 23:41 | shader and 1 busy thread | 5 ms every frame | 15.0 / 19.2 | kept | 5.5 | 8.8 | 6.63 | 8.7 | 18.3 | discarded; red (longest) without the bound |
| probe, no bound 23:44 | shader and 1 busy thread | 5 ms every frame | 16.5 / 19.1 | kept | 5.6 | 8.5 | 6.64 | 8.7 | 23.3 | bound removed: red (longest) |
| probe, no bound 23:47 | shader and 1 busy thread | 5 ms every frame | 16.5 / 18.9 | kept | 5.5 | 8.4 | 6.66 | 8.8 | 17.6 | bound removed: red (longest) |

Under every load measured, the 5 ms busy-wait reads red or the reading is discarded. Of its 23 readings under the
bound (the two probes aside), every one the bound keeps, or whose percentile was not saved and whose median does not
discard it, is red on both per-reference verdicts; the three green on all three verdicts are past the bound, at 7.0,
7.9 and 8.3. Every reading of the unchanged product the bound keeps is green on all three verdicts.

### Why the 95th percentile, and why 4 ms

The lane measured two ways a load inside §11's 40 per cent blinds the case.

1. **A load that slows the reference throughout.** Two memory-copy threads, or the shader beside busy threads,
   took the median of the reference to 5.3 to 6.3 ms in most readings, from 2.3 to 2.6 quiet. There the busy-wait
   read 6.29 to 6.84 on the mean per reference and 8.6 to 9.7 on the fifth-slowest, green, in all twelve such
   readings; the literal verdict caught it in nine of the twelve, and read the unchanged product red too in four of
   its five, so a red there said nothing about the product. Under the shader and one busy thread the load rose
   part-way through some readings, and the busy-wait read green on all three verdicts in three of six. Each verdict
   takes the lowest of ten: in the two of those whose timings were saved, the literal one took a run the load had
   not reached (its reference median 2.1 and 2.2 ms) and the per-reference ones a run it had (5.5 to 5.7).
2. **A load that takes the processor from single frames.** Three busy threads read the unchanged product's literal
   verdict 20.0 and 20.4 ms, red, in two of their four readings, with the reference's median at 2.4 ms in both:
   every run had frames over 16.7 ms, and in the 22:26 reading, whose timings were saved, the four slowest frames of
   every run were each followed by a reference timing of 4.9 to 9.7 ms.

The lane's first draft bounded the median of the runs' reference middles at 3.5 ms. It kept the 22:44 reading, the
busy-wait green on all three verdicts at a median of 3.5, and both three-thread reds at 2.4; a median moves with the
first kind of load and not the second. The 95th percentile moves with both: the second kind slows one timing in
twenty enough, and the first slows them all. The bound sits between the two groups the readings fell into:

- **3.1 to 3.8** in every reading where the case could tell the busy-wait from the product: quiet, a shader alone,
  two or three busy threads with the product green (3.2 to 3.4) or the busy-wait red (3.1 to 3.8).
- **5.1 to 10.2** in every reading under memory-copy threads or the shader beside busy threads, and 5.9 in both
  three-thread reds.

4 ms leaves the highest reading of the first group 0.2 ms under it and the lowest of the second 1.1 over. The
second group holds readings that were not blind: under one memory-copy thread (median 3.5 and 3.6) the busy-wait
still read red on all three verdicts, and those are discarded too. Three readings of the
unchanged product under two busy threads fell between, at 4.1, 4.1 and 4.2: discarded, and green, with the literal
verdict at 14.3 to 15.6 ms. The bound costs readings like those three, which a busier development machine will
produce more of; it buys a kept reading that never passes a regression the load hid, as far as these loads go. The
percentile is read at a resolution of 0.1 ms, which is what the timings carry.

### What it cannot see

- **A load that slows the frames and not the reference.** None of the four kinds did, and nothing here shows that
  none does. Such a load reads the product slower, toward red, not green.
- **A regression that slows the reference itself in more than one frame in twenty**, such as a garbage collection
  the product provokes falling in the reference's task: the case would be discarded at every reading, on any
  machine. It would never read green; it would never read red either, and the record would show a quiet machine
  discarding, which is the sign to look for.
- **Loads not tried:** a game (FIX-05's), disk-bound work, a load at a higher priority. Where a game ran beside this
  lane's first session on 2026-11-04 and 2026-11-05, at 42 to 43 per cent and discarded under §11, the reference's
  median read 8.4 and 8.8 ms.

## The launch race

Item 42. `launchBudgeted` added its five init scripts after `electron.launch` returned, and its comment said the
launch holds the application's `ready` until Playwright has connected, so a script added then would be in place for
the first document. The first half is true and the conclusion is not: Playwright 1.63.0's `Electron.launch` ends
with `await app.initialize()`, and `ElectronApplication.initialize` evaluates `__playwright_run()` in the main
process, which emits the held `ready` (read by this lane in `node_modules/playwright-core/lib/coreBundle.js`, as
E03-M01's review round 07 had). `src/app/main.ts` opens its window from `whenReady`, so the window can already be
loading while the five `addInitScript` calls are on their way.

Of the two repairs the task offered the lane took the reload:

- Every script is in the context once its `addInitScript` call has resolved, so a document created after the last
  call holds all five, in order, whatever happened before. `launchBudgeted` reads, in the document that has the
  renderer's view, which scripts ran and whether each ran before the renderer (`readInstalled` in
  `budgets-page.ts`, polled from Node so that the probe does not count the polling), and reloads the window if any
  is missing or late.

  > **Corrected 2026-11-08 by E04-M01-FIX-05.** The first sentence of this bullet holds only for a window that was
  > initialised before the call landed. E04-M01's review round 05 read in Playwright 1.63.0's `coreBundle.js` that
  > a context's `addInitScript` reaches only the pages already initialised, and that a Chromium page copies the
  > context's scripts once, as its initialisation starts. A call that lands between the two reaches no document of
  > that window, reloads included. FIX-05 read the same lines again, then planted a wait before one of the five
  > calls at its own Base (`7612190`). 12 of 18 launches of `budgets-frames.spec.ts:60` lost every script from
  > the delayed one on, after the reload too, and failed the guard. The waits were 20, 100 and 300 ms, before the
  > second, third or fifth call. FIX-05 now adds the five as one script. A reloaded document still without it gets
  > it added to the window's page and is reloaded again (`initScriptFirst` in `test/e2e/support/budgets.ts`).
- Holding the window instead would have needed code of the lane's in the application's main process, and would
  have added the five calls' round trips to every cold start a start case times. The reload changes nothing on a
  launch whose first document holds all five.
- A reload delays the first painted state, so `budgets-start.spec.ts` times no reloaded launch: it closes it and
  launches again, at most three times, and fails if the third is reloaded too.

The guard holds the five flags to five written out (`[true, true, true, true, true]`). Before this lane it compared
them with `INIT_SCRIPTS.map(...)`, which the lane's first probe found green with a script dropped from the list,
because the expected array shrank with it. The line the guarantee hinges on is that `expect` in `launchBudgeted`,
after `installedInView`.

## Fixed waits replaced

Item 22. The live-row case waited 100 ms after each scroll, and the canvas-redraw case 300 ms before each of its
three counts; a regression that asks for a frame some time after each scroll event is not counted when its frame
misses the wait. `wakeupsSettled` in `budgets-page.ts` waits, in the page, until every timeout, animation frame and
idle callback the page has asked for has run (the probe's `registered` and `fired` counts, kept by
`installTimerCounters`), and has stayed so through two rendering updates in a row, then returns the redraw count;
it throws after 30 s. Two updates, because a scroll written in one update is dispatched as an event in the next
one's scroll steps. It waits on the page's own scheduler as the probe took it before counting, so the waiting is
not counted. What it cannot wait for is a callback asked for after two quiet updates by something the probe does
not count, such as a reply from the main process; no case that reads a count after a scroll waits for one.

## A profile of its own

Item 4, its part in `budgets.ts`. Every launch gets `--user-data-dir` set to a directory made for it by
`mkdtempSync` under the system's temporary directory; `closeBudgeted` removes it, as do the failure paths of
`launchBudgeted`, retried because on Windows a file an exited process held can stay locked for a moment. A choice
the application keeps, a colour scheme or a branch selection, is no longer read from another suite's run or from
the person's own profile.

**Whether the move moved any reading.** On 2026-11-06 and 2026-11-07 from 23:52 to 01:20 local, five runs of
`npm run gates:budgets` at `701c337` were interleaved with three runs of its end-to-end part,
`npx playwright test --project=budgets`, with the `--user-data-dir` line taken out of `launchBudgeted` for the run
and restored from git after it. Each was judged by §11 case by case as above. Every case of all eight was kept,
except the last four cases of the second gate run (other load 44.8 to 60.0 per cent during the first two, and
40.5 to 44.4 in the minute before the last two), which are left out below. Every verdict of every run was `ok`.

| reading | own profile (gate runs) | default profile | limit |
| --- | --- | --- | --- |
| cold start, empty repository, fastest of ten | 1 029, 1 037, 1 048, 1 063 ms | 998, 1 051, 1 062 ms | 1 486.5 |
| cold start, first page of 300, fastest of ten | 1 054, 1 091, 1 093, 1 104 ms | 1 035, 1 097, 1 112 ms | 1 560 |
| ten thousand commits, one load, fastest of ten | 442.4, 448.9, 449.3, 452.5 ms | 442.7, 447.8, 452.4 ms | 635.25 |
| private bytes at 50 000 commits | 159.4 to 164.7 MB (five) | 162.2 to 166.3 MB | 173.1 MB |
| resident after five idle minutes over before | 0.991 to 0.995 (five) | 0.970 to 0.992 | 1.02 |
| processor while idle | 0.104 to 0.193 per cent (five) | 0.068 to 0.104 | 0.5 |
| resident after closing | 0 bytes (five) | 0 bytes | 0 |
| scrolled case: mean, fifth, longest | 4.851 to 5.038, 5.959 to 6.1, 6.4 to 7.0 (five) | 4.771 to 4.997, 5.9 to 6.037, 6.6 to 7.6 | 7.41, 10.0365, 16.7 |

No reading moved past the spread of its own runs: in every row the two ranges overlap, except idle processor
time, where they meet at 0.104 and the profile's runs read up to 0.193. Three runs against five cannot say whether
that is the profile; both are under two fifths of the limit. The benchmarks, which launch nothing, read 13.287 to
14.284 µs a commit parsed, 0.56 to 0.581 µs laid out and 42.582 to 44.914 ms to build, kept in all five gate runs at
6.8 to 9.4 per cent other load.

## What proves it

Each probe planted, watched red, removed, watched green; the probes of the last two were run on 2026-11-07
after the readings above, and the lane's first session had run the same probes of scopes 3 and 4 on 2026-11-04
with the same outcomes.

- **One 20 ms frame in the held run** (a 20 ms busy-wait in every 240th `paint`): the literal verdict read 24.8 and
  24.5 ms, `FAIL`, in two kept readings; removed, 6.7 and 7.0, `ok`.
- **The 5 ms busy-wait under each load**: red or discarded in all 23 readings, never kept and green (the table).
- **The reference bound removed** (`REFERENCE_BOUND_MILLISECONDS` set to infinity, under the shader and one busy
  thread): the 22:41, 22:44 and head 23:38 readings print every verdict under its limit and would have read green;
  the two probe readings at 23:44 and 23:47 read the literal verdict red at 23.3 and 17.6 ms and both per-reference
  verdicts green. With the bound, all of them are discarded.
- **An init script dropped from the first window** (`installRedrawCounter` taken out of `INIT_SCRIPTS`): the
  golden-graph case failed on the guard's `toEqual`, four flags where five were expected; restored, it passed.
- **A frame asked for 10 s after every scroll event**, planted in `src/ui/graph-table.ts`: with Base's fixed waits
  (the spec of `4a6a949` put back for the run) the canvas-redraw case read 120 redraws and 1, green; with
  `wakeupsSettled` it read 240 and 27, red; removed, 120 and 1, green, and 37 row elements.

`npm run gates:quick` on 2026-11-07, at `701c337` with these documents uncommitted: exit 0 in 5 minutes 3 seconds, the
end-to-end tier 63 of 63. In it the budget cases that hold counts, also on a profile of their own now, read their
baselines: 37 row elements at 300 commits and at 10 000, 120 redraws for 120 scrolled frames and 1 for a burst, and 6,
5 and 5 git processes to open, refresh and load more.
