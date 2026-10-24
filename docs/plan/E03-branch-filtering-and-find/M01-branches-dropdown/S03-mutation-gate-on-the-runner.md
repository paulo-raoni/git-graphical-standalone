# E03-M01-S03 · The mutation gate reads a coloured run as it reads a plain one

## What changed

The mutation gate now reads every kill's recorded output as plain text. A new module,
`scripts/gates/mutation-output.js`, takes the terminal escape sequences out of a captured vitest run, and the
gate applies it in two places, before any clause reads anything:

- `scripts/gates/mutation.js` strips every mutant's `statusReason` once, as the report is read: the line that
  parses the report now passes its files through `plainFiles`. That is the only line of the gate's logic that
  moved; the other two changes to that file are its import line and one header sentence.
- `scripts/gates/mutation-remeasure.js` strips the output of each run the re-measure clause makes, where it
  collects that output, so `verdictOf` reads plain text too. It also re-exports `plainFiles`, because
  `mutation.js` is at its 300-line limit and could take a second name from an existing import line but not a
  new import line.

Nothing else moved: no clause, threshold, clock, survivor entry or command line. `stryker.config.json`,
`vitest.config.js` and `.github/workflows/ci.yml` are not in this lane's diff. Every measurement below was taken
by this lane on 2026-10-23 and 2026-10-24, in UTC, on the eight-core development machine, at `dc8c381` (the
base), at `31c73c1` (the change as first made) or at `b2e2e73` (the change as it stands, which adds what *A
sequence split in two* below found).

## The cause, measured

The first continuous-integration run (GitHub Actions run 39157409731, at `27498c8`) refused the gate with
"1314 of the 1314 killed mutants' recorded output names no failing test (100.0%, cap 25%)" and refused to
re-measure 1 314 kills. Its report had expired, so this lane could not read that run's output. What follows
reproduces it here.

**Vitest 5.0.0 decides on colour in two places, read from its installed code.** Its colours come from
`tinyrainbow` 3.1.1, whose test is: off if `NO_COLOR` is set or `--no-color` is on the command line; otherwise
on if `FORCE_COLOR` is set, `--color` is on the command line, the platform is Windows, `TERM` is anything but
`dumb` (unless `FORCE_TTY` is `false`), or `CI` is set. Then vitest's command line turns colours off again when
`std-env` 4.2.0 detects an AI agent and `FORCE_COLOR` is not set. `std-env` detects one from `AI_AGENT`, or
from a variable of a known agent, `CLAUDECODE` and `CLAUDE_CODE` among them.

**So on this machine the gate's runs were plain only because an agent started them.** The per-mutant command,
`node node_modules/vitest/vitest.mjs run --reporter=dot --fsModuleCache --bail=1 --no-cache --no-isolate`, run
once over the healthy suite in each environment, counting escape characters in its whole output:

| environment of the command | escape characters |
| --- | --- |
| this agent's session as it is | 0 |
| `AI_AGENT`, `CLAUDECODE` and `CLAUDE_CODE` removed | 1 560 |
| those removed, and `CI=true`, `GITHUB_ACTIONS=true` set | 1 560 |
| those removed, `CI` and `GITHUB_ACTIONS` set, `TERM` removed | 1 560 |
| this session as it is, with `CI=true` and `GITHUB_ACTIONS=true` added | 0 |
| this session as it is, with `FORCE_COLOR=1` added | 1 560 |
| agent variables removed, `CI=true`, `NO_COLOR=1` | 0 |

A GitHub Actions runner sets `CI` and runs no agent, so by that code every kill's output there is coloured.
That is read from the code and reproduced here, not observed on a runner. The same table says that the owner
running the gate from his own terminal on this machine, with no agent, would get coloured output too; that the
gate would then refuse his run is the same reading as below, and was not run that way.

**What colour does to the reading.** A coloured kill's summary line is
`ESC[2m      Tests ESC[22m ESC[1mESC[31m1 failedESC[39m…`: the line starts with an escape and another sits between
`Tests` and its count, so `FAILING_TESTS = /^\s*Tests\s+\d+ failed\b/m` cannot match it.

**The runner's reading, reproduced at the base.** The gate run with the runner's environment (`CI=true`,
`GITHUB_ACTIONS=true`, the three agent variables removed) through a small wrapper, narrowed to
`--mutate src/core/store/growth.ts` (a narrowed run, said to be one), and the same narrowed run as this session
starts it:

| run, at `dc8c381` | mutants | named no failing test | re-measured | verdict |
| --- | --- | --- | --- | --- |
| runner's environment | 16: 14 killed, 2 timeout | 14 of 14, 100.0 % | 14, every one "could not be measured" | exit 1, 15 findings |
| this session's environment | 16: 14 killed, 2 timeout | 0 of 14 | 0 | exit 0, `mutation: ok` |

The fourteen re-measured runs were coloured too, since they inherit the environment, so the clause read
"no test failed and no error names the mutated file" from each. The two reports agree on every status. Their
kills' outputs hold 9 598 escape characters in the coloured report and none in the plain one.

The full-scale finding was reproduced as well, by replaying the base's gate over a coloured report of the whole
scope (the second full run below, made after the change): with `mutation.js` and `mutation-remeasure.js` put
back to their `dc8c381` text in the working tree for that one replay, `--check-report` exited 1 with the
runner's two findings word for word, at 1 316 where the runner had 1 314: "1316 of the 1316 killed mutants'
recorded output names no failing test (100.0%, cap 25%)", and the refusal to re-measure 1 316 kills. So the
orchestrator's inference was right in its mechanism, and this lane adds why this machine never showed it.

## Where the fix lives, and why there

**In the reader, not in the command.** Three places were possible:

- **Ask the command not to colour**, with `--no-color` or `NO_COLOR` in `commandRunner.command` or on the job.
  That fixes the runner by trusting every future run to start without colour, which is what failed here: the
  plain output on this machine was itself an accident of who started the run. A `FORCE_COLOR` set anywhere
  above the job, a vitest that changes its test, or the owner running the gate himself would each bring the
  codes back, and the gate would refuse a correct run with a finding that says nothing about colour. It would
  also change the command S12 and FIX-36 measured every verdict under.
- **Set an environment variable on the `mutation` job** in `.github/workflows/ci.yml`. The same objection, for
  the runner only, and it would leave the gate's behaviour on this machine depending on the caller.
- **Strip the codes before any reading.** Every reading the gate makes is a regular expression over text, so
  the text is what is normalised, once, where the report is read and where the second runs are collected. The
  gate then gives the same verdict however the run printed, which is this slice's outcome, and on output with
  no escape sequence the stripping is the identity, so nothing that was plain moves.

The third was taken. `ci.yml` needs no change for it, and does not change.

**The line the guarantee hinges on is `ESCAPE_SEQUENCE`** in `mutation-output.js`. It removes a control
sequence (`ESC [`, its parameter and intermediate bytes, and one final byte, which covers every code
`tinyrainbow` writes), an operating-system command ended by `BEL` or `ESC \`, and a two-character escape, and no
character outside an escape sequence, except a line break found inside a control sequence (next section). It is
built from code points because a control character written into a pattern fails ESLint's `no-control-regex`
here, which this lane checked by linting one.

### A sequence split in two

The first form of the pattern, at `31c73c1`, left one escape character in each of 2 of the 1 316 kills' outputs
of the second full run below (`src/core/store/commit-store.ts` 289:54 and 297:56, both `ArithmeticOperator`),
where the report read `ESC[`, a line break, then `39m`, in the middle of a long diff. The cause is Stryker's,
read in `command-test-runner.js` of `@stryker-mutator/core` 10.0.0: it records a failing run's output as the
chunks it read from the pipe joined with `os.EOL`, so a chunk that ends inside a sequence splits it with a line
break vitest never printed. Neither of the two changed a verdict, but the same split in front of `Tests` would
leave the rest of the sequence at the start of that line and hide the count. A control sequence never holds a
line break of its own, so `b2e2e73` lets one be inside it and removes it with the sequence. With that, no
escape character is left in any kill's output of either full report: 896 710 before stripping in the second
run's, 893 598 in the first's, none after. Every replay in the next sections was run again at `b2e2e73` and
gave the same verdict as at `31c73c1`.

## Every reading, checked against coloured output

Each reading the gate makes of a kill's output was evaluated on four real vitest runs, made in a scratch
project with the per-mutant command's flags, each run twice: once as this session starts it and once with the
runner's environment. The cases were a failing assertion, a test that never settles under a 300 ms clock, a
test file whose imported module throws on import, and a test that kills its own worker.

| case | escapes, plain / coloured / coloured after stripping | readings that differ on the raw coloured output | readings that differ after stripping |
| --- | --- | --- | --- |
| failing assertion | 0 / 92 / 0 | failing-test counter, failed-file counter, the excerpt's lines | none |
| test that never settles | 0 / 74 / 0 | failing-test counter, failed-file counter, the excerpt's lines | none |
| module that breaks on import | 0 / 66 / 0 | failed-file counter, the excerpt's lines | none |
| worker that dies | 0 / 108 / 0 | the worker pool's own line, the excerpt's lines | none |

The readings evaluated were the failing-test counter (`FAILING_TESTS`, in both files), the failed-file counter
(`FAILING_FILES`), vitest's own clock (`VITEST_CLOCK`), the broad clock words read with the pool's lines removed
(`CLOCK_WORDS` after `POOL_LINE`), the pool's line itself, the words of a suite that starved (`STARVED`), the
mutated file's name in an error (the `own crash` verdict's test), and the lines the excerpt quotes
(`OUTCOME_LINE`), each copied unchanged from the two scripts at the base. In all four cases the stripped coloured
output was identical to the plain one, character for character, once vitest's `Start at` and `Duration` lines
were dropped. So the broken readings were not only the one that failed on the runner: the worker pool's line
was missed too, so, by the same reading and not produced here, a coloured `Timeout terminating forks worker …`
would have been left for the broad clock words to refuse an honest run with; and the excerpt lost most of its
lines. `VITEST_CLOCK`, `CLOCK_WORDS` and `STARVED` happened to read the coloured text correctly in these cases,
since in these outputs the codes fall around their words and not inside them; they now read plain text anyway.

On the narrowed reports above, mutant by mutant, every reading agreed between the plain report and the
coloured one after stripping for 14 of the 14 kills, and for none of them on the raw coloured output.

## The replays and the runs

**Replays** (`--check-report`, which runs no Stryker):

| report | at `dc8c381` | at `31c73c1`, and again at `b2e2e73` |
| --- | --- | --- |
| the narrowed report made in the runner's environment (coloured) | exit 1, one finding: 14 of 14 kills name no failing test | exit 0, `mutation-replay: ok`, 0 of 14 |
| the narrowed report made in this session (plain) | exit 0, `ok`, 0 of 14 | exit 0, `ok`, 0 of 14 |
| the full report of the second run below (coloured) | exit 1, the runner's two findings | exit 0, `ok`, 0 of 1 316 |

The base's replay of the coloured narrowed report re-measured its fourteen kills in this session's environment,
plain, and all fourteen failed a test; it was refused by the cap alone.

**The line it hinges on, watched failing.** `plainOutput` changed to return its text unchanged, and the full
coloured report replayed: exit 1, two findings, the runner's. Restored with `git checkout`, the same replay:
exit 0, `ok`. Done at `31c73c1` over the second run's report and at `b2e2e73` over the third's, with the
same four results both times.

**Three full runs of `node scripts/gates/mutation.js`**, which is the whole of `npm run gates:mutation`, over the
configured scope, unnarrowed, with the runner's environment set, exit status read directly from the process.
The first had the probe FIX-36 used planted: in `src/core/store/growth.test.ts`, the single assertion of
*keeps signed values signed*, `toEqual([-600, 330, 0])`, replaced with `toHaveLength(3)`, which leaves
`growth.ts` 73:3 `CallExpression` to `;` with no test that kills it. Predicted before it: exit 1, one finding
naming that mutant, four survivors, kills naming a failing test near 100 %. The second ran after the probe was
removed with `git checkout` and `git status --short` printed nothing. Both were at `31c73c1`. The third ran at
`b2e2e73`, after *A sequence split in two*, so that the change as it stands has a full run of its own.

| run | started, ended | Stryker's part | killed | timeout | survived | kills carrying vitest's clock | on a clock | kills naming no failing test | re-measured | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| probe planted | 10-23 23:57:05, 10-24 00:38:57 | 2 494.3 s | 1 315 | 34 | 4 | 3 | 37 of 1 349, 2.7 % | 2 of 1 315, 0.2 % | 2, both "a test failed" | exit 1, one finding |
| probe removed | 10-24 00:41:07, 01:35:41 | 3 270.4 s | 1 316 | 34 | 3 | 3 | 37 of 1 350, 2.7 % | 0 of 1 316 | 0 | exit 0, `mutation: ok` |
| at `b2e2e73` | 10-24 01:42:09, 02:15:22 | 1 978.3 s | 1 316 | 34 | 3 | 2 | 36 of 1 350, 2.7 % | 1 of 1 316, 0.1 % | 1, "a test failed" | exit 0, `mutation: ok` |

- The probe run's one finding: `src/core/store/growth.ts:73:3 CallExpression (to ";") survived and is not in
  scripts/gates/mutation-survivors.json`. Survivors against the list of three: 4 and 3, one not on the list.
- Its two kills naming no failing test were genuine casualties, not colour: `src/core/parse/bytes.ts` 118:28
  `BlockStatement`, whose output is vitest's pool reporting a worker that "exited unexpectedly with exit code 1
  during starting state" with no test run, and `src/core/store/pending-parents.ts` 185:7
  `AssignmentOperator`, whose output is empty. The re-measure clause ran each again alone, in the runner's
  environment, so coloured, and read "a test failed" from both after stripping. At the base those two second
  runs would, by the same reading and not run that way, have read as no test failed, the way the narrowed
  reproduction's fourteen did.
- The probe-removed run is the runner's verdict this slice exists for: **1 316 of 1 316 kills name a failing
  test, 100 %**, against 0 of 1 314 on the runner. FIX-36's full runs on this machine, as its section of
  `docs/plan/E01-commit-graph/M01-first-graph/S12-mutation-without-isolation.md` records them, read 0 of 1 316
  naming no failing test; this lane did not reproduce those, and its own runs agree with them. Survivors
  against the list: 3 and 3. Every one of the 1 316 kills' recorded outputs carried escape codes in the report.
- The run at `b2e2e73` reads the same: 1 315 of 1 316 kills name a failing test, 99.9 %. The one that does not,
  `src/contracts/column-read.ts` 66:7 `EqualityOperator`, has an empty recorded output, and its second run,
  coloured, read "a test failed". Survivors against the list: 3 and 3. 1 315 of its kills' outputs carried
  escape codes, 897 558 in all, and none was left after stripping.

**Load.** Another lane of this project and other projects' agents shared the machine. A sampler read the
processor load across all processors and the node processes in the table, meant every five seconds; under the
load each sample took up to a minute, so the three runs have 46, 32 and 102 samples. Their mean load was 99.6,
99.6 and 96.0 %, ranging from 90 to 100, 88 to 100 and 28 to 100 %. The sampler counted a process of another
worktree of this project in 2 samples of the first run and none of the others, and of another project in 4
samples of the first and 4 of the third; it can only attribute a process whose command line holds a path, and vitest's and Stryker's workers
hold relative ones, so those counts are a floor. No reading here is a wall-clock verdict, so none was
discarded; the three durations are not a comparison.

## What is still unproven

- **The runner itself.** Everything above is this machine with the runner's variables, never a GitHub Actions
  runner. The first push the owner asks for is the measurement; what to read in its `mutation` job is the line
  `… of the <n> killed mutants' recorded output names no failing test`, which should read near nought, not
  1 314 of 1 314.
- **Linux.** The runner is `ubuntu-latest`; this machine is Windows. The colour test above is the same on both
  except that Windows always colours and Linux colours unless `TERM` is `dumb`, and in any case when `CI` is
  set, which it is there. That the
  output has no other Linux-only shape that a reading misses is not measured.
- **An escape sequence outside the forms `ESCAPE_SEQUENCE` takes.** After stripping, none was left in any
  kill's output of the reports here, but a vitest that started writing another form would make readings miss
  again, and the failure would look like this one: a share of kills naming no failing test far above nought.
- **A chunk boundary inside plain text.** Stryker's join can put a line break inside any line, not only inside
  an escape sequence, and one inside vitest's `Tests` line would hide the count however the run printed. That
  is older than this lane, colour or not, and was not measured; the re-measure clause is what catches such a
  kill today, by running it again.

## What would make someone revisit this

- **A run whose kills mostly name no failing test.** That is this defect's signature; read one kill's
  `statusReason` in the report for escape characters before anything else.
- **A change to the `vitest` pin.** Its colour test, or `std-env`'s agent detection, could move, and with them
  which runs are coloured. The stripping does not depend on either, which is why it was chosen, but the table
  of environments above would then need taking again.
- **A new reading of a kill's output.** It reads plain text only if it reads the files `plainFiles` returned or
  an output `runAlone` collected; one that read the report from disk again, or ran a command of its own, would
  have to strip it too.
