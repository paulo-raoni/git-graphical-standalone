# E01-M01-S10 · Fifty thousand commits and the memory budget as first written

When this slice ran, on 2026-10-02, `docs/ADR-0002-architecture-and-performance.md` decision 6 budgeted
**resident memory, all processes, 50 000 commits loaded, at ≤ 400 MB**, and E01-M01-S07 had measured the
assembled application over it, at 463 to 477 MB on 2026-09-28. This slice was asked to make it fit, or to show
with measurements that it could not inside the decisions already taken.

**Against that row, it could not.** The window open on a repository with **no commits at all** already read
406.0 to 409.4 MB in five runs, summed over the working sets: over the 400 000 000 bytes that row allowed,
before a single commit was loaded. No change to what a load holds could bring that sum under a floor that was
itself over the limit, so no product code was changed. What follows is the floor, the attribution of the load,
and what each change that was not this slice's to make would have bought, measured.

## What changed after this slice

**The row this document measured is no longer the budget.** On 2026-10-03 the owner ruled that the memory row
of decision 6 counts the **sum of the private bytes** of every process of the application, and the decision
was amended that day; the row now reads *"Memory, all processes, 50 000 commits loaded: the sum of their
private bytes"*, and its limit, 400 MB in SI megabytes, is unchanged. The amendment quotes this document's
readings as its grounds.

Every verdict below — *over*, *fits*, *no*, *could not* — is about the row as it was written on 2026-10-02,
the sum of the working sets, and none of them is a verdict on the budget as amended. This slice read the
private bytes too, at the same moments, and they are in the tables below: 174.4 to 182.5 MiB with 50 000
commits loaded, which is 182.9 to 191.4 MB, under 400.

The budget as amended is measured and held elsewhere:
`docs/plan/E01-commit-graph/M01-first-graph/S07-budgets-baselines-render-stability.md`, section *Memory at
50 000 commits, and what closing gives back*, and the end-to-end case it names,
`test/e2e/budgets-memory.spec.ts`, which holds the sum to the entry `privateBytesAt50000` of
`perf/baselines.json` and to the 400 MB ceiling. That section's verdict is that the application meets the
budget; its figures are its own and were not re-measured for this document. By its account the private sum
goes on falling for about a minute after the rows are painted, so a reading taken ten seconds after the
paint, as this document's readings of the process table were, is higher than the one the case now takes.

## How every figure here was taken

Measured by this slice's executor on **2026-10-02**, between 19:41 and 20:05 local time, on the development
machine S07 describes (an Intel Core i5-10310U, 16 GB, Windows 11 Pro 10.0.26200), with the application built
by `npm run build` at commit `ca4bab6` and run on Electron 44.3.0.

**The method is S07's**, rerun rather than quoted: launch the built application with Playwright's Electron
launcher, the folder on the command line; for a load, ask the bridge for the rest of the commits in one
`window.gitGraphical.loadMoreCommits({ count })` and hand the reply to `window.gitGraphicalView.showPage`; wait
until the table's spacer is sized for every row; ask the main process for its own process identifier; wait
ten seconds; read every process descended from it from Windows' process table (`Win32_Process`); and sum
their working sets. Private bytes are read from the same table at the same moment. Megabytes (MB) are SI,
so the limit is 400 000 000 bytes, which is 381.5 MiB; per-process figures are in MiB, written as working set
/ private bytes. The driver was a script outside the repository, and nothing of S07's lane was copied into
this one. The fixtures were the shared `large` repositories of `test/e2e/support/fixtures.ts`, 10 000 and
50 000 commits, a straight chain; the empty repository was made with `git init` and nothing else.

**Load condition.** Other agent sessions and a WSL virtual machine were running on the machine and were not
this slice's to stop. At each reading the processor load sampled from `Win32_Processor` was between 3 and 100
per cent, free physical memory between 4.2 and 5.8 GB, and the commit charge between 19.9 and 23.0 GB of
27.7 GB; each reading below was taken with that sample beside it. One exploratory reading taken before the
series, with 0.4 GB of physical memory free in the sample taken just after it, read 272.9 MiB for the window
with no repository, 33 to 36 MiB under the series below — so **a working set depends on how hard the machine is pressing
for memory**, and a reading on a quieter machine can be higher than these. It is not part of the series.

## The floor, at `ca4bab6`

Five runs of each, totals in MB:

| state | processes | working sets, five runs | private bytes |
| --- | --- | --- | --- |
| no repository open | 4 | 321.5, 320.9, 323.6, 324.3, 321.1 | 111.0 to 115.2 MiB |
| an empty repository open | 5 | 409.4, 406.0, 406.4, 408.7, 409.4 | 137.0 to 140.4 MiB |
| 10 000 commits loaded and painted | 5 | 433.0, 441.2, 428.8, 432.3, 444.1 | 153.0 to 165.6 MiB |
| 50 000 commits loaded and painted | 5 | 451.3, 451.3, 455.8, 456.8, 453.4 | 174.4 to 182.5 MiB |

The second 10 000-commit run counted a sixth process, 5.0 MiB of working set, which the table could not name;
that it was a git process still exiting is an inference, not an observation. S07 read 463 to 477 MB at
50 000 commits on 2026-09-28; these five are 451 to 457 MB under the load condition above.

Per process, the range over each set of five runs, working set / private, MiB:

| process | no repository | empty repository | 10 000 | 50 000 |
| --- | --- | --- | --- | --- |
| main | 97.6–97.8 / 35.6–36.0 | 97.8–100.8 / 35.3–39.2 | 98.7–101.5 / 36.6–40.1 | 102.1–105.4 / 40.4–44.3 |
| GPU | 83.0–84.5 / 36.8–36.9 | 83.5–84.0 / 37.2–37.6 | 89.6–91.7 / 43.0–43.4 | 89.9–91.5 / 43.0–43.4 |
| network service | 48.3–48.8 / 11.9–12.2 | 48.3–48.6 / 11.7–12.1 | 48.2–49.1 / 11.9–12.0 | 48.3–48.8 / 11.8–12.0 |
| renderer | 76.2–79.3 / 26.4–30.0 | 77.9–80.9 / 27.5–30.2 | 83.8–90.0 / 32.1–35.8 | 89.9–92.5 / 39.0–42.9 |
| utility (`repository.cjs`) | not running | 79.1–79.3 / 23.4–24.6 | 88.2–96.7 / 28.9–30.0 | 98.0–102.2 / 39.3–43.0 |

### The decision the floor makes

Opening a repository starts the utility process, and the utility process alone adds 79.1 to 79.3 MiB of
working set while holding no commit: the window on an empty repository read **6.0 to 9.4 MB over** the
row as it was then written. Decision 3's own figure for the store is at most 96 bytes a commit, so 50 000 commits held once in
each of the three processes that need them — the utility process that builds them, the main process that
forwards them, the renderer that draws them — occupy at most 14.4 MB. The room that row left for that was
not 14.4 MB or less; it was **less than nothing**. A load that held no byte beyond the floor would still have
failed it.

So scope item 2 was not attempted: anything it removes comes out of the 42 to 51 MB the load adds above the
floor, and the floor alone did not fit under the sum of the working sets.

Most of each working set is not this application's memory at all. A working set counts every page a process
has mapped and touched, and Electron's own binary and libraries are mapped into all five processes and
counted once for each; the gap between a process's working set and its private bytes is 54.7 to 55.8 MiB in the
utility process on an empty repository, and **about 250 MiB summed over the five**. That is what S07's
document said the reading was when this slice ran (its text of 2026-09-28, since rewritten for the amended
row), measured again here; the amendment to decision 6 now says the same.

## Where the load goes: 50 000 commits against the empty repository

Between the empty repository and 50 000 commits the working sets grow by 42 to 51 MB. By process, comparing
the ranges above: the utility process about 19 to 23 MiB, the renderer about 9 to 15, the GPU process about
6 to 8, the main process about 1 to 8, and the network service nothing.

Inside the three JavaScript processes, read in two further runs of each state with instruments the product
does not carry: `process.memoryUsage()` in the main process (through Playwright) and in the utility process
(through a reporter appended to the built `dist/repository.cjs`, which `npm run build` removes, answering the
bridge's existing `applicationInfo` request), and the DevTools protocol's `Runtime.getHeapUsage` in the
renderer. **Garbage was told from live memory by forcing a collection from the instrument** — the protocol's
`HeapProfiler.collectGarbage` in the renderer and V8's `gc` exposed at run time in the two Node processes —
and reading again. The product forces no collection.

| process | at the empty repository | at 50 000, before the forced collection | after it |
| --- | --- | --- | --- |
| utility, V8 heap used | 3.3–3.4 MB | 7.4–7.6 MB | 3.4 MB |
| utility, memory outside the V8 heap | 2.3 MB | 8.2 MB | 8.2 MB |
| main, V8 heap used | 4.4 MB | 5.0 MB | 4.1 MB |
| main, memory outside the V8 heap | 2.9 MB | 6.6 MB | 6.6 MB |
| renderer, V8 heap used | 2.9 MB | 3.8 MB | 2.6 MB |
| renderer, `ArrayBuffer` backing stores | 0.3 MB | 7.6 MB | 3.8 MB |

What that says, and how far it can be trusted:

- **The commits themselves are small.** What a load adds outside the V8 heaps and survives a collection is about
  5.9 MB in the utility process (where the store's columns, its hash index, the row block, the copied page and
  the object names kept for `continuesBlock` live), 3.8 MB of backing stores in the renderer (the page it
  holds) and about 3.7 MB in the main process — roughly 13 MB in all, inside the 14.4 MB decision 3 allows three copies.
- **The main process keeps 3.7 MB outside the V8 heap after it has forwarded the reply**, and a forced
  collection does not release it. What holds it was not found; that it is Electron's message plumbing keeping
  the last structured clone is an inference.
- **The renderer holds one collectable copy of the page beside the live one**: 3.8 MB of backing stores that a
  forced collection frees. The reply is deserialized once in the preload's isolated world and copied again by
  the context bridge into the page's world; that the garbage is the first of those two is an inference from
  the size, which matches the live page.
- **Collectable garbage was about 9 to 10 MB of the working sets**: forcing a collection in all three
  JavaScript processes took the two totals from 451.5 and 454.1 MB to 442.4 and 444.2 MB. None of the
  working-set readings in this document is under 400 MB because a collection happened to run, and none would
  have been had one run in every process.
- **The rest of the growth is invisible to these instruments**: about 7 MiB in the GPU process, which runs no
  JavaScript (that it is the compositor's tiles for the painted rows is an inference), and most of the
  utility process's growth, which is more than its 10 MB of JavaScript-visible memory — memory touched while
  git's output streamed through and parsed, and kept by the allocator, by inference. Electron reports
  `arrayBuffers` as 0 in both Node processes, so typed arrays there cannot be told from other memory outside
  the V8 heap.

## What would have made the working sets fit, and whose each change is

*Fits* in this section means the sum of the working sets under 400 000 000 bytes, the row as it was written on
2026-10-02. None of the changes to the product below was built by this slice. Each was applied **transiently** — a Chromium switch on the command line, or a patch
of the built `dist/main.cjs` that `npm run build` removes — run five times at 50 000 commits on 2026-10-02
between 19:53 and 19:59 under the load condition above, and removed. Totals in MB:

| change | owner | processes | working sets, five runs | fits |
| --- | --- | --- | --- | --- |
| none (the five readings above) | — | 5 | 451.3 to 456.8 | no |
| the repository host on a **worker thread of the main process** instead of a utility process | decision 2 | 4 | 381.1, 382.2, 381.1, 381.7, 384.8 | **yes**, by 15.2 to 18.9 |
| the GPU process run inside the main process (`--in-process-gpu`) | a switch that changes which processes exist | 4 | 414.3, 416.0, 420.0, 417.6, 416.4 | no |
| both of the above | both | 3 | 339.4, 338.0, 338.7, 340.4, 336.7 | yes, by 59.6 to 63.3 |
| hardware acceleration off (`--disable-gpu`) | a switch | 5 | 443.0, 448.6, 442.0, 440.5, 440.8 | no |

- **The worker thread** is the one change that fits alone. The patch replaced `utilityProcess.fork` in the
  built main bundle with a `worker_threads` worker that loads the same `repository.cjs` and hands it a
  `parentPort` of the same shape, so every request and reply was the same; the 50 000 rows painted as at
  `ca4bab6`. It removes the 79 MiB the utility process costs before it holds anything and puts the store in
  the main process, whose working set rose to 129.6 to 132.4 MiB. It still keeps parsing off the thread that
  owns the window. What it gives up is decision 2's other reason for a separate process — that ending the
  process returns its memory to the operating system — and the isolation of a crash; neither was measured.
- **The GPU process in the main process** buys 31 to 42 MB comparing the two sets of five, not enough alone.
- **Hardware acceleration off** keeps a GPU process, running in software, and buys 3 to 16 MB comparing the two sets of five.
- **The network service in the main process** was tried with the two Chromium feature names
  `NetworkServiceInProcess` and `NetworkServiceInProcess2`, one run each; in both the network service was
  still a separate process, so what folding it in would buy was not measured. It holds 48.3 to 48.8 MiB of
  working set and 11.8 to 12.2 MiB private.
- **The budget itself** is decision 6, the owner's. Held against the sum of the working sets, as it was when
  this was measured, the application at `ca4bab6` read up to 456.8 MB in these five runs and up to 477 MB in
  S07's of 2026-09-28. Held against the sum of the private bytes, the reading that counts nothing twice, it
  read 182.9 to 191.4 MB at 50 000 commits. That is the change the owner took, on 2026-10-03 (*What changed
  after this slice*, above).

## What a person sees

The built application at `ca4bab6`, opened on the 50 000-commit fixture, all of it loaded over the bridge:
`commit 50000` at the top under the `main` label with the HEAD ring on its dot, one straight line down lane 0.
Scrolled to the foot in 70 steps, it ended on `commit 1`, the root, with no Load More control below it; pressed,
Refresh answered in 1 108 ms, the table still held 50 000 rows, the scroll offset was kept and the same rows
were on screen. Looked at by this slice's executor on 2026-10-02.

## What remains

The row as it was written on 2026-10-02 could not be met without one of the changes above, and each of them
was the owner's or a recorded decision's. The owner took the last of them the next day: the budget counts the
private bytes, and by this slice's own readings the application was already under it. What this slice left of
scope item 2 is what this document attributes: the renderer's second copy of the page, the 3.7 MB the main
process keeps after forwarding, and the utility process's memory that no JavaScript instrument here could see.
Those three were measured at `ca4bab6` and have not been measured again for this document.
