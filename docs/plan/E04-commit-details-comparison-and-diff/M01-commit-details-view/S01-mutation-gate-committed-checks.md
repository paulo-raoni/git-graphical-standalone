# E04-M01-S01 · The mutation gate's committed checks

## What changed

- **The survivor list is keyed by what a mutant does, not where it sits.** An entry of
  `scripts/gates/mutation-survivors.json` names a mutant by its file, mutator, the source text it replaces
  (`original`, every run of white space read as one space) and its replacement, and one entry excuses one
  surviving mutant. The key is `identityOf` in `scripts/gates/mutation.js`, and the count is in
  `unlistedFindings`: a run with more survivors of one key than the list has entries for it refuses the extra
  ones. `src/contracts/bridge.ts` has its blank line back between its imports and `BRIDGE_GLOBAL_NAME`, which
  now sits on line 15.
- **The re-measure clause stops a second run where Stryker would have.** Its outer clock was `timeoutMS` alone,
  120 000 ms. It is now `outerClockOf` in `scripts/gates/mutation-remeasure.js`: `timeoutFactor` times the dry
  run's net time, plus `timeoutMS`, plus the dry run's overhead, which is the formula of `createMutantRunPlan` in
  `node_modules/@stryker-mutator/core/dist/src/mutants/mutant-test-planner.js` (10.0.0), read there. Where each
  value comes from is below.
- **Three committed checks under `test/gates/`**, collected by `vitest.fixtures.config.js` and so run by
  `npm run gates:unit` in the quick and full tiers: `mutation-output.test.ts` (the coloured reading),
  `mutation-remeasure.test.ts` (the re-measure verdicts and the outer clock) and `mutation-survivors.test.ts`
  (the survivor key). Each replays a fixture cut from a real run of this tree. `test/gates/report.ts` is what they
  share.
- **What made the checks possible.** `mutation.js` runs its gate only when it is the program (`main`, guarded at
  its last line), so a check can import `tally`, `readSurvivors`, `survivorFindings` and `VITEST_CLOCK`;
  `remeasure` takes an optional fourth argument carrying the report's `config`, a dry-run record and the `runs`
  to make, each read or made as before when left out. `excerptOf` moved from `mutation.js` to
  `mutation-output.js`, and `mutation.js` imports `fileNameOf` from `mutation-remeasure.js` instead of keeping a
  copy, which keeps `mutation.js` at 292 of its 300 lines (ESLint's own `max-lines` count). `stryker.config.json`
  adds the `event-recorder` reporter.
- **The header of `vitest.fixtures.config.js`** names its two patterns and what each holds, without a count.

Nothing else moved: no threshold, cap or inner clock, the per-mutant command, the mutated folders, and no survivor
beyond re-keying the two the list had. `npm run gates:mutation` keeps its command, its exit codes and its verdict
lines; it prints one new line, under the re-measure summary and only when it re-ran something:
`… each mutant run alone was stopped after <n> ms, the budget Stryker gives a mutant: …`. The survivor clause's
messages name an entry by its text instead of its position.

Every measurement below was taken by this lane on 2026-11-03 on the eight-core development machine, times in the
machine's local time, UTC−3. The runs:

| run | what | when | verdict |
| --- | --- | --- | --- |
| r1 | `node scripts/gates/mutation.js` over the configured scope, at the base `9f5a1ac` with the blank line of `bridge.ts` restored (the gate's logic still the base's), `FORCE_COLOR=1`, `CI=true`, `GITHUB_ACTIONS=true`, Stryker's `event-recorder` added on the command line | 18:28 to 19:41 | exit 1, the two findings the base's key makes of the restored blank line (below) |
| replay | `--check-report` over r1's report, at `7ca375d`, the same three variables | 20:11 to 20:18 | `mutation-replay: ok`, exit 0 |
| probe | `node scripts/gates/mutation.js --mutate src/contracts/bridge.ts,src/core/store/growth.ts`, narrowed and said to be, planted then removed (item 1 below) | 20:28 to 20:36 | exit 1, then exit 0 |
| g1 | `npm run gates`, the full tier, at `7ca375d`, as this agent's session starts it (plain output) | 20:37 to 22:42; Stryker's part of its mutation step 4 681.7 s | exit 1: every gate from `gates:format` to `gates:build` green, `mutation: ok`; `gates:e2e` red, 2 of 60 cases out of their waits (`branches-dropdown.spec.ts:330`, a 30 s `locator.uncheck`; `graph-table.spec.ts:393`, its 60 s test timeout); the gates after it not reached |
| g2 | `run-s` of the tier's gates from `gates:build` on, at `7ca375d` | 22:43 to 23:00 | exit 0: `gates:e2e` 60 of 60, `gates:perf` 65 of 65, `size`, `licences`, `provenance`, `commits`, `placeholders` ok |

**Load.** A sampler of this lane read the processor load across all processors about every five seconds, whole machine,
this lane included, and the `node.exe` command lines once a minute: r1 674 samples, mean 99.9 %, 673 over 75 %; g1
1 152 samples, mean 99.7 %, 1 149 over 75 %; g2 160 samples, mean 96.7 %, 156 over 75 %. Node processes of the
milestone's two other lanes were in 48 of r1's 57 minute samples, 94 of g1's 96 and 13 of g2's 14. No gate of this
lane's tier reads a wall clock as its verdict; g1's two end-to-end reds were waits running out under that load, the
shape `docs/PLAN.md` item 16 records, which is an inference: a new build of the same commit passed all 60 cases in g2, and neither
case reads anything this lane changed beyond the one blank line it put back in `src/contracts/bridge.ts`.

## The survivor key

**The line the guarantee hinges on is `identityOf`** in `scripts/gates/mutation.js`, with the count of
`unlistedFindings` beside it. Three keys were weighed:

- **The enclosing declaration's name.** It survives a moved line, and also an edit anywhere in the declaration,
  but it needs a parser in the gate and is shared by every mutant of a declaration, so it would key nothing by
  itself.
- **File, mutator, replaced text and replacement.** All four are in Stryker's report already (the text is the
  file's recorded `source` over the mutant's `location`), none moves when a line is added above, and the text
  tells apart what the position told apart before: the `true` and `false` mutants of one `if` differ in their
  replacement, and a compound condition mutated whole and in part differs in its text. Taken.
- **The four above and an ordinal among equal keys.** It would say which of two equal mutants an entry was
  written for, at the cost of moving when an equal one is added above, which is the defect this item removes.

Text is not unique. Measured on r1's report by a script over every mutant: **205 of the 1 568 mutants share all
four fields with another, in 87 groups**, the same expression mutated the same way in two places of a file;
neither survivor is in one. Under the old five fields 45 mutants shared a key. So the match **counts**: an entry
excuses one survivor, and a second survivor of a listed key is refused, which the check holds with a second copy
of the bridge constant pasted at the end of the file. What a key cannot say is which of two equal mutants an
entry is for, and the guarantee does not need it, since the two survive for the same reason.

An entry whose text the source no longer holds names nothing and refuses, as before; the message now says that an
edit to the listed text looks like that, where it used to say a moved line did.

**Re-recorded against r1.** Its two survivors are the two the list had: `bridge.ts` 15:35 `StringLiteral`, over
`'gitGraphical'`, to `""`, and `bytes.ts` 144:20 `EqualityOperator`, over `at < units.length`, to
`at <= units.length`. No survivor appeared or disappeared. Under the base's key r1 refused twice for the restored
blank line alone: the bridge entry at 14:35 named nothing, and the same mutant at 15:35 was a survivor not on the
list. The replay of r1's report under the new key read `matched a mutant of this run 2 … not on the list 0`.

**On the real gate, narrowed** (the probe run): with a comment line added above `BRIDGE_GLOBAL_NAME`, moving it to
line 16, and the one assertion of *keeps signed values signed* in `src/core/store/growth.test.ts` neutered
(`toEqual([-600, 330, 0])` to `toHaveLength(3)`), the gate over `bridge.ts` and `growth.ts` matched the bridge
entry and refused exactly one survivor, `growth.ts` 59:3 `CallExpression` over
`target.set(source.subarray(0, used));`, exit 1. Both plants reverted with `git checkout`, `git status --short`
empty, the same run: matched 1, not on the list 0, `mutation: ok`, exit 0.

## The coloured reading, held

`test/gates/mutation-output.test.ts` replays `fixtures/coloured-kills.json`, four kills of r1 with their recorded
output exactly as Stryker wrote it, coloured, save the run's absolute root written `<root>`: `lane-layout.ts`
390:15 (a short failing assertion), `segment-buffer.ts` 97:7 (one of r1's three kills on vitest's clock),
`commit-store.ts` 289:54 (one of r1's two outputs holding a control sequence the `os.EOL` join cut in two) and a
`growth.ts` kill of median length. It checks that raw, the gate's own `tally` finds no failing test in any of
them; that after `plainFiles` no escape character is left, `tally` finds every failing test and no clock word it
cannot read, and the text equals a second reading written for the check (a character walk that takes out each
`ESC [` … final byte, line breaks inside it included); and that `plainOutput` is the identity on plain text.

**The reading held is `ESCAPE_SEQUENCE`** in `scripts/gates/mutation-output.js`, through `plainOutput` and
`plainFiles`.

## The re-measure verdicts, held

`test/gates/mutation-remeasure.test.ts` replays `fixtures/remeasure-report.json` through `remeasure`, with the
runs handed in from the fixture in place of the copy of the tree, one case per verdict, each reading the verdict
the clause prints, what it refuses and the status it hands on: a kill re-measured and counted (`assertion`), a
kill on vitest's clock again (`clock`), a kill on the clock alone past the outer clock (`clock`), a pass handed on
as a survivor, a kill that names its failing test left alone, the starvation guard (a kill on the clock whose
suite also starved, past the outer clock, refused), a kill that starves again, a kill naming no failing test past
the outer clock, and the refusal of every chosen kill when the copy fails with no mutant planted, which is the
clause refusing unchanged source rather than measure on it.

The fixture's `comment` says where each output came from: kills' outputs of r1, the per-mutant command run once
with no mutant in this worktree after r1 (18 744 ms, `441 passed`), and the same command with node's heap capped at
8 MB, which died before it ran a test with `JavaScript heap out of memory`. Three are put together from real ones
and said to be: no kill of r1 starved, so the starved kill's output is that capped run and the clock-and-starved
kill's is a clock kill's output with that run's two lines appended; and no kill of r1 had its `Tests` line split,
so the kill naming no failing test is a real kill's output with one `\r\n` put inside the word `Tests`, as
Stryker's join would leave it (next section).

What the check does not hold is the copy of the tree and the process it runs (`sandboxRuns`, `runAlone`,
`stopTree`): only a real run of the gate exercises them, and r1, the replay and g1 did.

## The outer clock

Each value, where it is read from, and what was measured:

- **`timeoutFactor`, 1.5, and `timeoutMS`, 120 000**, from the report's `config`, which is Stryker's options with
  its schema defaults filled in (`stryker.config.json` does not set the factor; Stryker's schema default is 1.5,
  and 5 000 for `timeoutMS`, which `stryker.config.json` sets). For a report with no `config` the clause reads
  `stryker.config.json` and then those defaults.
- **The dry run's net time and overhead**, from `*-onDryRunCompleted.json`, which the `event-recorder` reporter
  writes under `eventReporter.baseDir` (`reports/mutation/events`, gitignored, and emptied by Stryker at the start
  of each run). In r1: net 18 553 ms, overhead 3 ms.
- **The larger net time** of that record and the clause's own run with no mutant planted.

**Measured in r1's plan**, `onMutationTestingPlanReady.json`, also written by the recorder: Stryker gave every one
of its 1 568 mutants a timeout of 147 832.5 ms, which is 1.5 × 18 553 + 120 000 + 3, the formula above with r1's
values. In the replay the clause's run with no mutant took 29 679 ms on a saturated machine, longer than the dry
run, so its clock was 164 522 ms. The two `hash-index.ts` 120:7 mutants E03-M01's round 03 saw past the old clock
went past this one too, alone, in the replay, and were counted through `pastTheOuterClock`'s clock reading, as
before; the third kill on the clock, `segment-buffer.ts` 97:7, timed out on vitest's clock again. In g1 the dry run took 17 845 ms with 8 ms of overhead, Stryker planned every mutant at 146 775.5 ms (1.5 × 17 845 + 120 000 + 8), and the clause's run with no mutant took 32 659 ms, so its clock was 168 997 ms; of the same three kills, `segment-buffer.ts` 97:7 timed out on vitest's clock again, `hash-index.ts` 120:7 `ConditionalExpression` failed a test inside the clock, and `hash-index.ts` 120:7 `EqualityOperator` went past it and was counted as a clock kill. How long the second of these took was not recorded, so whether it would have ended inside the old 120 000 ms is not known.

What it costs: the recorder writes one file per mutant tested besides the dry run, the plan and the report: 1 571
files, 36 MB, under `reports/mutation/events/` for r1. Taking the timeout from Stryker's log line instead would
have meant piping Stryker's output, which takes the progress bar away from a terminal, and its log file is written
to the repository root, which `.gitignore` does not list.

## The `os.EOL` join, measured

Stryker's command runner records a failing run's output as the chunks it read from the pipe joined with `os.EOL`
(`completeResult` in `command-test-runner.js` of `@stryker-mutator/core` 10.0.0, read there), `\r\n` on this
machine, and vitest writes `\n`. So removing every `\r\n` from a kill's recorded output gives back what vitest
wrote, and each one removed is a join. A script over the raw report counted, for every join, whether it fell at the
end of a line of what vitest wrote or inside one, inside an escape sequence or plain text, inside vitest's `Tests`
or `Test Files` summary line, and whether the gate's failing-test reading of the recorded output differs from its
reading of what vitest wrote:

| run | kills | joins | at a line's end | inside a line | of those inside an escape sequence | inside the `Tests` line | inside the `Test Files` line | kills whose failing-test reading the joins change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1, coloured | 1 532 | 195 652 | 26 778 | 168 874 | 2 | 0 | 0 | 0 |
| g1, plain | 1 532 | 192 790 | 26 903 | 165 887 | 0 | 0 | 0 | 0 |

Almost every join inside a line is in vitest's progress line of the `dot` reporter, which writes its dots a few at
a time (read from the joins' neighbours in r1's report, not counted per line). g1's output carried no escape code, as
E03-M01-S03 measured for a run this agent's session starts, so its sequences could not be split. Three of r1's outputs, and two of g1's, hold a `\r` vitest wrote itself, not followed by `\n`; none of them is a join.

**Whether the re-measure clause always recovers the kill**: in these runs it had nothing to recover, since no join
hid a count. By its code it would: a kill whose `Tests` line a join cut so that the failing-test reading misses it
names no failing test, so it is chosen, and its second run is collected whole (`runAlone` concatenates the pipe's
bytes, no join), so a failing test is read there as in any other run. A join between `Tests` and its count is
white space to `\s+` and hides nothing. The case is held by the check: the fixture's kill naming no failing test is
a real output with a join put inside `Tests`, re-measured and counted. That is the whole of what is measured; a
join that cut a kill's output in a way the second run does not repeat would still be recovered, and one whose
second run starves is refused, as for any kill.

## The checks, watched failing

Each plant was applied to the committed file, the check run, the file restored with `git checkout`, the check run
again, `git status --short` empty after each:

| plant | check | planted | removed |
| --- | --- | --- | --- |
| `plainOutput` returns its text unchanged | `mutation-output.test.ts` | 3 of 7 failed | 7 of 7 passed |
| `JOIN` never matches (a split sequence left in) | `mutation-output.test.ts` | 2 of 7 failed | 7 of 7 passed |
| the starvation guard of `pastTheOuterClock` removed | `mutation-remeasure.test.ts` | 1 of 10 failed, the guard's case | 10 of 10 passed |
| the `assertion` verdict removed | `mutation-remeasure.test.ts` | 1 of 10 failed, the counted kill's case | 10 of 10 passed |
| the refusal of a copy that fails with no mutant removed | `mutation-remeasure.test.ts` | 1 of 10 failed, that case | 10 of 10 passed |
| a re-measured pass no longer handed on as a survivor | `mutation-remeasure.test.ts` | 1 of 10 failed, that case | 10 of 10 passed |
| the `clock` verdict past the outer clock removed | `mutation-remeasure.test.ts` | 1 of 10 failed, that case | 10 of 10 passed |
| the outer clock back to `timeoutMS` alone | `mutation-remeasure.test.ts` | 1 of 10 failed, the clock's case | 10 of 10 passed |
| the matcher back on line and column, the two entries given their recorded line and column | `mutation-survivors.test.ts` | 4 of 6 failed: both moved-line cases, the second copy, the edited text | 6 of 6 passed |

## What would make someone revisit this

- **A change to the `@stryker-mutator/core` pin.** The outer clock copies its formula and reads the recorder's file
  name and the report's `config`; a version that changes any of them changes what the clause reads. The check holds
  the formula against the fixture's values, not against Stryker.
- **A survivor whose text is shared** with another mutant of its file. It is matched by count, which is enough for
  the guarantee; the entry's `why` then speaks for both.
- **A reading of a recorded output added outside `mutation-output.js`.** The coloured fixture holds what is read
  through `plainFiles`; a reading of the raw report would not be held by it.
