# E04-M01-S04 · End-to-end isolation

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S04 end-to-end
isolation

Nothing in the window changed in this slice. The eight end-to-end suites of the `application` project that
launched on the default user-data directory now launch on one of their own (the cases that launch through
`test/e2e/support/budgets.ts` still do not); the clause of the utility process that drops a selection overtaken
by a later one is held by a case that goes red without it; the suite was run under load and its limits read; the
polls of the row-budget case were weighed; a case launched through the shared helper can no longer put a real
message box on the screen; and five sentences of E03-M01's slice documents that later work had made untrue carry
dated corrections. It takes the items 4 (but `test/e2e/support/budgets.ts`, which is
E04-M01-S05's), 16, 17, 21, 26 and 38 that E03-M01's reviews carried into this milestone (`docs/PLAN.md`). It has
no reference behaviour of Git Graph: it is test work.

## A profile of its own for every launch

**What was wrong.** The application keeps a theme choice in a file `theme` (`src/app/theme.ts`) and a branch
selection per repository in a folder `branch-selections` (`src/app/selections.ts`), both under its user-data
directory, and reads the theme back at every start and a repository's selection at every open. Eight suites
launched it with no `--user-data-dir`, so on the profile of whoever ran them: `window.spec.ts`,
`open-repository.spec.ts`, `graph-table.spec.ts`, `open-scroll.spec.ts`, `refresh-control.spec.ts`,
`stale-load-more.spec.ts`, `superseded-reply.spec.ts` and `branch-selection.spec.ts` (found by a search of
`test/e2e/` for `electron.launch` at this slice's Base, which agreed with the planning survey's list).
`graph-geometry.spec.ts` launches nothing. A choice left in that profile carried into the runs, and
`branch-selection.spec.ts` wrote a kept record into it: at this slice's start the development machine's default
profile held one, for the shared `remotes` fixture's path, with the selection `refs/heads/topic` that suite's last
case ends on.

**The helper.** Every one of the eight now launches through one function of `test/e2e/support/fixtures.ts`:

```ts
export interface Launch {
  readonly open?: string;
  readonly env?: Record<string, string>;
}

export async function withOwnProfile<T>(
  launch: Launch,
  body: (application: ElectronApplication) => Promise<T>,
): Promise<T>;
```

It makes a fresh directory under the system's temporary directory (`git-graphical-standalone-profile-` and six
random characters), launches the built application with `.`, the folder in `open` if any, and
`--user-data-dir=<that directory>`, in the environment `env` when one is given, runs `body`, closes the
application whatever `body` did, fails unless its process has exited, and removes the directory with the retries of
`removeDirectory` (`test/fixtures/shared-store.ts`). A suite written later launches through it the same way; a case
that needs two launches to share one profile, to read back a choice across a restart, still passes
`--user-data-dir` itself, as `theme.spec.ts` and `selection-kept.spec.ts` do. Playwright is imported inside the
function rather than at the top of the module, because the Vitest suites of `perf/` and `test/fixtures/` import
`fixtures.ts` for its repositories and load no Playwright.

**The line the isolation hinges on** is the `--user-data-dir=${home}` argument of the `electron.launch` call in
`withOwnProfile`. No case reads which profile it ran on, so nothing in the suite would fail without it, and the
isolation is held by a measurement instead, below.

**What the measurement is.** `theme` and `branch-selections` of the default profile (`%APPDATA%` and the
application's name, on Windows) are read before and after a full `npm run gates:e2e`, and reduced to two SHA-256
digests by a script outside the repository: one over each entry's name and bytes (whether `theme` exists, every
record's name, size and digest), which is the byte identity the task asks for, and one over the same with every
entry's modification time added, which also shows a write that put back the same bytes. The second matters on
this machine: the record `branch-selection.spec.ts` leaves when run on the default profile has, since this slice's
race case, different bytes from the one found there, but before it the suite's last case wrote exactly the bytes the
profile already held.

**What it read.** Each run below is a full `npm run gates:e2e` in this lane's worktree on 2026-11-04 and
2026-11-05 (UTC), with the process table sampled about every six seconds for `electron.exe` main processes and
which worktree's copy of Electron each was:

| run | lane commit | content digest | write digest | launches on the default profile seen during the run |
| --- | --- | --- | --- | --- |
| 1 | `8f45d71` | changed | changed | the review's and E04-M01-S06's worktrees, both at this slice's Base, from 00:23 to 00:50; none from this worktree. Sampled from 00:23 only, 27 minutes into the run |
| 2 | `c243c48` | unchanged | unchanged | four from this worktree, 02:54 to 02:56; E04-M01-S06's |
| 3 | `c243c48` | unchanged | unchanged | four from this worktree, 03:26 to 03:27; another project's |
| 4 | `c243c48` | unchanged | unchanged | four from this worktree, 04:22 to 04:26; another project's |

The four launches of this worktree in runs 2 to 4 fall in the minutes the three untagged cases of
`budgets-frames.spec.ts` and `budgets-git.spec.ts` and the one of `golden-graph.spec.ts` ran, the four cases that
launch through `launchBudgeted` (below); matched by time, not by command line. Run 1's change is not this lane's to
the evidence available: the record was already 74 bytes, not the 59 found at the start, when the run began, and
other worktrees at Base, whose `branch-selection.spec.ts` writes that record, launched on the default profile
during it. A run that went across an edit of `withOwnProfile`, and one cut off when the session running it ended,
are not counted.

On 2026-11-05, 35 further full runs (*The suite's limits under load*, below), from 07:23 to 17:14, all at
`819609b`, whose tree is the tree of `cd53626` and whose test files are those of `c243c48`: both digests were
unchanged around each of the 35. The `git-graphical-standalone-profile-*` directories `withOwnProfile` makes were
counted in the system's temporary directory after them: one was left, made on 2026-11-04 at 23:01 local time
(02:01 UTC, 2026-11-05) during the run that went across the edit of `withOwnProfile`, and none from the 35.
(Commit hashes in this document are those of the lane after its messages were reworded on 2026-11-05; each
replaced commit kept its tree.)

**The probe.** `branch-selection.spec.ts` alone, put back on the default profile by a launch without
`--user-data-dir` and run on its own on 2026-11-04 at 23:28 to 23:36: the suite passed, 5 of 5, and both digests
changed, the record going from the selection `refs/heads/topic` to the empty selection the race case ends on. The
record was then written back with its bytes and its modification time (to the millisecond) and the probe removed.

**What it does not cover.** The case of `golden-graph.spec.ts` and the three untagged cases of
`budgets-frames.spec.ts` and `budgets-git.spec.ts` are cases of the `application` project and launch through
`launchBudgeted` of `test/e2e/support/budgets.ts`, which this slice may not change (E04-M01-S05's): they still run
on the default profile. None of them chooses a theme or applies a selection, so each reads a kept record and
writes none; that is read from the cases, and the unchanged digests of runs 2 to 4 agree with it. A launch written into a case later without
`withOwnProfile`, or an instance a case starts by itself, is not covered by the function, and only the digest
would show it.

## The drop of an overtaken selection, held

`select` in `src/app/repository-host.ts` drops a reply when a selection asked for after it has already been
applied: `open.selectedBy > ticket`. E03-M01's review round 04 removed that clause and `branch-selection.spec.ts`
stayed green 12 of 12, because no case made an earlier selection's read end after a later one's.

**The case** *a selection overtaken by a later one is dropped when its reply would arrive last* sends two
selections together over the bridge: first `refs/heads/feature`, whose read runs git's log for a first page, then
a selection naming no branch, for which the adapter runs no log at all (`selectsAnyRevision`,
`src/adapters/git-commands.ts`), so its read ends first and it is applied first. Every reply is drawn in the order
it arrives, as the renderer draws them. The case requires the page drawn last to be the later selection's, and a
`refresh({})` afterwards to read under it; it runs the race three times in one window, and requires the earlier
selection to have been answered `cancelled` in at least one of them, so that it cannot pass on rounds that only
ever read in the order they were asked. The line the guarantee hinges on is `open.selectedBy > ticket` in `select`.

**Measured on 2026-11-04**, by a probe outside the committed suite driving the same pair through the built
application: the earlier selection was answered `cancelled` and the later one drawn in 10 of 10 rounds, and then in
40 of 40, with every five-second sample of the machine's processor load at 100.0 % during the first five of that
run's seven minutes (the first ten rounds' load was not sampled during them; it was 100.0 % half an hour before).
Two other pairs were tried and not kept: with the later selection naming a branch that does not exist, which still
runs a log, the order held in 7 of 10 rounds; with the earlier one naming 1 500 branches that do not exist besides
`feature`, it held in 10 of 10, at about seven seconds a round.

In the three runs of the whole gate under load on `c243c48` (below) the case passed each time, in 58 s, 1.1 min
and 2.1 min; in the run on `8f45d71`, with a load of this lane's own added, it failed at its first page's
ten-second wait, before any race was sent. In the 35 runs of 2026-11-05 it passed each time, in 9.5 to 35.7 s.
No round was read on a free machine: no run of this lane was free (*Wall-clock gates on a shared machine*,
`AGENTS.md` §11; the readings are below).

**With the clause removed** from the built application, the case went red in 2 of 2 runs, the page drawn last
being the earlier selection's 300 commits; restored, the whole suite passed in 2 of 2 runs.

## The suite's limits under load

**Under load.** Four full runs of `npm run gates:e2e` (64 cases) under a declared load. Load is the processor
load across all eight processors, sampled about every six seconds from the process table (`Win32_Process`
times against the idle process), split into this run's own process tree and everything else; "others" below is
everything else. Run 1 added a load of this lane's own, one spinning thread per processor, started after a check
that no command line named `gates:budgets` or `--project=budgets` and stopped when the run ended; runs 2 to 4
added none, because the machine was already saturated by other projects (a WSL virtual machine, a game client,
other lanes' gates).

| run | lane commit | time | load (others) | red | the limits that ran out |
| --- | --- | --- | --- | --- | --- |
| 1 | `8f45d71` | 62.3 min | 99.5 % from 00:23 (busy 100 %), own load added | 15 | test 60 s ×7, test 180 s ×2, `expect` 10 s ×6 |
| 2 | `c243c48` | 37.2 min | 99.0 % (busy 95.1 to 100 %) | 1 | `expect` 10 s ×1 |
| 3 | `c243c48` | 42.0 min | 99.1 % (busy 99.2 to 100 %) | 4 | `expect` 10 s ×2, test 60 s ×1, test 180 s ×1 |
| 4 | `c243c48` | 61.8 min | 99.4 % (busy 83.9 to 100 %) | 16 | test 60 s ×6, test 180 s ×1, `expect` 10 s ×7, `expect.poll` 10 s ×1, action 30 s ×1 |

This run's own tree was sampled at 0.5 to 1.0 % of the machine on average in each, which undercounts it: the
process table misses every process that starts and ends between two samples, and the time a process spent before
its first sample, and a run of this suite starts about 2 500 processes (counted on 2026-11-05 with a job object,
below, where the run's own share was 17.8 to 19.0 % at a lower load). So the "others" column above holds some of
the run's own load, by an amount not measured. The cases that ran out were different
from run to run: 23 distinct cases over the four, in 9 of the 14 files of the project that launch the application;
13 of them ran out in one run, 7 in two, 3 in three and none in all four. Run 2's one was the first page of
`branch-selection.spec.ts`'s first case; runs 3 and 4 were mostly `selection-kept.spec.ts`, `theme.spec.ts`, `branches-dropdown.spec.ts` and `refresh-control.spec.ts`.
`gates:e2e` at round 01's free 3.1 minutes (item 17) took 37 to 62 minutes here.

**What the limits are.** `playwright.config.js` sets two: 60 s a case and 10 s an `expect`. Every other limit
that ran out is set elsewhere: a case's own `test.setTimeout`, or `test.describe.configure` for a whole file
(the 180 s of `branch-selection.spec.ts`, `branches-dropdown.spec.ts` and `selection-kept.spec.ts`, among
others), and Playwright's 30 s wait for an action. `branches-dropdown.spec.ts`, `selection-kept.spec.ts` and
`theme.spec.ts` are outside this slice's boundary.

**On 2026-11-05, waiting for a free machine.** 35 more full runs at `819609b`, each started only after a check
that no command line named `gates:budgets` or `--project=budgets`, none with a load of this lane's own:

| runs | UTC | how load was read | minute before (average) | during the run, others (average; highest sample) | time | red |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 07:23 to 07:39 | process table, about every 2.5 s | 100.0 % | 97.1 %; 100 % | 15.4 min | 1: `selection-kept.spec.ts:329`, `expect` 10 s |
| 4 | 12:16 to 13:08 | process table, about every 2.5 s | 32.2 to 41.7 % | 70.8 to 85.6 %; 92.0 to 99.9 % | 6.6 to 8.7 min | none |
| 30 | 13:14 to 17:14 | job object, about every 2 s | 25.0 to 38.5 % | 53.5 to 62.0 %; 72.6 to 100 % | 6.1 to 7.1 min | 1, not a limit (below) |

The first was started on a busy machine by a fault of this lane's waiting script, which read a minute it could not
parse as free; it is kept as a loaded reading. The review's `gates:budgets` run began at 12:17:39, a minute after
the first of the four, and ran beside this lane's run, which was not stopped, to about 12:30. For the
30, the run was started inside a Windows job object and its own time read from the job's accounting, which counts
every process the run starts, including those that end between two samples (about 2 500 a run); the run's own
share was 17.8 to 19.0 % of the machine on average. Total load was read from the system's idle time. The one red
of the 30, at 15:04 to 15:10, was *Dark and Light override the preference at once, keeping the scroll and the
page* in `theme.spec.ts`, outside this boundary: the canvas compared at line 222, after a fixed 300 ms wait, was
not the canvas read before the switch. That is an assertion, not a limit running out.

**Why none of them was free.** In each of the 30 the minute before was free and the run was not: others
averaged 17.0 to 31.3 points more during the run than in the minute before it, and the next run's minute before
was free again. Some of that is load the run itself causes
outside its own tree. Sampling every process every ten seconds during the second of the 30 showed the virus scanner
(`MsMpEng`) at 13.8 % of the machine and `svchost` at 6.6 % on average, against 1.6 % for the scanner in one
ten-second reading at rest at 12:58, and 5.6 % and 1.4 % over two minutes at rest at 17:15. That the rest of the
rise also comes from the run is an inference. By `AGENTS.md` §11's measure, which counts all load outside the
reading's own tree, a run of this suite on this machine cannot be free unless the load at rest is well under
40 %. In the minute before each of the 30 it was 25.0 to 38.5 %, and a game client took about 16 % of the
machine in each per-process reading.

**The three free runs: the orchestrator's ruling.** No run of this suite can meet `AGENTS.md` §11's free measure
on this machine (above), and 35 runs taken while waiting did not change that. On 2026-11-05 the orchestrator ruled
that the 30 runs of 13:14 to 17:14, whose minute before was free (25.0 to 38.5 %) and whose load outside the run's
own tree during the run was 53.5 to 62.0 %, stand in for scope 3's three free runs, and that no further run of the
suite is taken. They ran under more load than a free machine would carry, and no case of them ran out of a limit.
That a case green under that load is green on a free machine is an inference, not a reading: none was taken free.
Before those runs, session 1 had watched for a free machine as well: of the 3 214 samples it took between 21:49
on 2026-11-04 and 06:14 on 2026-11-05 (all but 12 of them five seconds apart), 7 read a processor load under 75 %,
the lowest 38.0 %, and from 05:45 to 06:14 no minute averaged under 77 % (the stretches between its runs were not
all sampled).

**The decision: no limit changes.** `playwright.config.js` is as it was at Base. The readings behind it, all from
the runs above:

- Limits ran out only in the five runs with others at 97 % or more (four of session 1 and the run of 07:23 on
  2026-11-05, all on a machine already saturated when they started), and the set of cases that ran out changed from
  run to run at that load, from 1 to 16 of 64, so a limit raised for the cases of one run would not have held the
  next.
- In the 34 runs of 2026-11-05 whose others averaged 53.5 to 85.6 %, no case ran out of a limit: 33 were green, and
  the one red was an assertion (above), not a limit.
- The orchestrator's ruling is that no gate of this project is read at 97 % load or more, which is the load at
  which limits ran out.

A run that timed out says only that a wait needed more than its limit, not how much more. Of the 23 cases that ran
out in session 1's four runs, 20 ran out only at a limit the configuration sets and 3 ran out at least once at a
limit set elsewhere (the cases listed below), so a raise decided in this lane could not have made three saturated
runs green.

**Found outside this lane.** Listed for the orchestrator, who carries them; this lane changed none:

- the 180 s `describe.configure` of `selection-kept.spec.ts`, which ran out for two of its cases under load;
- Playwright's 30 s action wait in a case of `branches-dropdown.spec.ts`, which ran out once under load;
- the fixed 300 ms wait before the canvas compare at line 222 of `theme.spec.ts`, behind the one red in 34 runs at
  moderate load;
- the order "wait for the application to exit, then remove the profile", which `withOwnProfile` has and
  `theme.spec.ts` and `selection-kept.spec.ts` lack (the `EPERM` of the latter's `afterAll`, above).

## The row-budget case's polls

*Live row elements stay inside the budget* in `test/e2e/graph-table.spec.ts` counts the rows the view has made
after handing it a page of 1 000 commits and after each of four scrolls over one of 10 000, and each count waits
first until no animation frame the view asked for is still to run (`expect.poll` on `due`, E03-M01-FIX-02).
E03-M01's review round 03 removed those waits and the case stayed green 5 of 5.

**They stay.** They guard a read that would otherwise race the frame that makes the rows: a count read before the
first page's frame reads no row and fails the case on a correct view, and a count read before the last scroll's
frame reads the rows of the offset before it, which would hide a view that makes too many rows only at its final
offset (both read from the case, not planted). **The race is real**: in a probe outside the suite on 2026-11-04, ten launches at 100 % processor load,
`due` read in the round trip right after the first page was handed was 1, a frame still to run, in 7 of the 10, and
0 after each scroll in all 40. In that probe the count that followed was never early (37 rows each time), because
the probe's own read of `due` took a round trip first; the case without its polls reads the count in that round
trip instead. **What they cost**: the five polls together took 134 to 230 ms a case in five launches at that load,
against a case of several seconds. A green 5 of 5 without them says the race is usually won, not that it cannot be
lost.

## No real message box from a test

A *Not kept* message box (`sayUnkept`, `src/app/window.ts`, from E04-M01-S03) appeared on the owner's screen
during a test run on 2026-11-04 and stayed until they pressed OK; the file it named was a `theme` under a
temporary directory. The application raises it when a write into its profile fails, and the box is not awaited,
so it stays on the screen while the run goes on.

**What `withOwnProfile` does about it.** Two things, both in `test/e2e/support/fixtures.ts`:

- **It removes a profile only after the application has exited.** The removal sits in a `finally` that first
  waits for the launched process's `exit` (`ended`), up to ten seconds, then stops the process, which is this
  run's own, and waits again. Before this, the directory was removed after `close()` even when the exit check
  that follows it threw. The line the order hinges on is `if (child !== undefined) await ended(child);` before
  `removeDirectory(home)`.
- **It holds every message box.** Once the application has started, `holdMessageBoxes` replaces
  `dialog.showMessageBox`, `showMessageBoxSync` and `showErrorBox` in the main process with a recorder that shows
  nothing and answers as if OK were pressed, and the case fails if any was asked for (`requireNoMessageBox`). A
  probe on 2026-11-05, a case raising a box through `dialog.showMessageBox`, failed with *the application asked
  for a message box: probe box*; `window.spec.ts` passed 3 of 3 with the recorder installed, and the probe was
  removed. A box raised before the recorder is installed is not held; the application raises none before a
  choice is written (read from `src/app/theme.ts` and `src/app/selections.ts`).

**Whether this lane's runs could show one.** The eight suites choose no theme. They apply selections only in
`branch-selection.spec.ts`, where every reply, and so every write (`refresh` in `src/app/handlers.ts` awaits it),
is awaited before the case ends, on a profile no case removes while it runs. A count across whole runs could not
be taken from inside the main process: Playwright deletes `NODE_OPTIONS` from the environment it launches
Electron with (`delete env.NODE_OPTIONS` in its Electron launcher, read in `playwright-core` 1.63.0 as installed), so a
preloaded counter never loads. So during runs 3 and 4 above, and run 2 from its twelfth minute, a script outside
the repository listed every visible top-level window of class `#32770` (the class E04-M01-S03 recorded for the
box) owned by an `electron.exe` process, every two seconds: it listed none. That it would have listed a real
box is an inference from that class; it was not tried against one.

**Where else one can come from**, outside this slice's boundary: `theme.spec.ts` and `selection-kept.spec.ts`
remove their profiles in an `afterEach` or `afterAll` hook, which Playwright runs after a case has failed or run
out of time, and neither hook waits for the application that case launched to exit (read from both files). In runs 1, 3 and 4 above, the
`afterAll` of `selection-kept.spec.ts` failed with `EPERM` removing such a directory after some of its cases had
failed, which is what removing a directory a running process still holds looks like on Windows (an inference); that a write into a removed
profile then raised the box the owner saw is an inference. The temporary directory of this lane's runs was
`%LOCALAPPDATA%\Temp` itself (`os.tmpdir()` in its shell), and the path in the owner's box was under a `claude`
folder inside it, so that box came from a profile this lane's runs did not make (an inference from the path).

## Five sentences corrected

Each correction is dated and sits under the sentence it corrects, as E04-M01-S02's do.

- `S01-theme-selector.md` said a theme write that fails is reported on the error stream only; since E04-M01-S03 the
  window says it too, in a *Not kept* message box.
- `S12-selection-kept-per-repository.md` said the same of a selection write that fails, in two places, and that the
  Show Remote Branches checkbox is checked before the first page, where it is indeterminate since E04-M01-S03.
- `S12-selection-kept-per-repository.md` also said `branch-selection.spec.ts` leaves a record in the default
  profile, which this slice ended; that fifth correction is this slice's own consequence, not one E04-M01-S03 found.
