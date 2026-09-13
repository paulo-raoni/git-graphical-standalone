# E01-M01-S02 · The gate pipeline, the commit store and CI

What a reader of the code needs to know about the fifteen gates, the one workflow, and the first real module
of `src/core/`.

## What exists now

Nothing a user sees has changed: the application still opens one window and says `No repository is open.`
What has changed is everything around it. `npm run gates` now runs **fifteen** gates rather than five, in the
order `docs/ADR-0003-quality-gates-and-ci.md` §2 puts them, and `.github/workflows/ci.yml` calls the same
scripts. Under `src/core/store/` there is the columnar commit store the whole of wave 3 consumes, at a
mutation score of 100.00 over its 269 mutants with no survivor, and under a ninety-six byte per commit budget
that a benchmark measures on every run.

## The commit store

`docs/ADR-0002-architecture-and-performance.md` decision 3 says the store is **struct of arrays, not array of
structs**, because a JavaScript object per commit costs three to five hundred bytes once the engine has added
its header and shape, and fifty thousand of them are traced on every major garbage collection. This is that
store. It is pure: no I/O, no Electron, no DOM, no timers, no randomness, and no module-level mutable state.

### What later lanes call

| function | what it does |
| --- | --- |
| `createCommitStoreBuilder(initialCapacity?)` | an empty store, sized for `initialCapacity` commits before it grows |
| `appendCommit(builder, commit)` | appends one `AppendedCommit` and returns the row it landed in |
| `buildCommitColumns(builder)` | the page as `CommitColumns`, with arrays exactly the contract's lengths |
| `retainedByteLength(builder)` | every structural byte the store holds, message text excluded |
| `storeWork(builder)` | the deterministic work counter the performance gate reads |
| `commitCount(columns)` | commits in the page |
| `hexHashOf(columns, row)` | the object name of a row, in hex, produced on demand |
| `subjectOf(columns, row)` | the subject, sliced out of the page's one message blob |
| `parentsOf(columns, row)` | the parents, as a view over the flat parent column |
| `authorOf(columns, row)`, `committerOf(columns, row)` | a `Person`, from the interned table |

The accessors take the page as a parameter and keep nothing, so the same functions read a page built in this
process and a page that arrived over the IPC boundary as transferred buffers, with no rehydration step.
S03 feeds `appendCommit`; S04 and S05 read through the accessors.

`AppendedCommit` is flat, and it is **not retained**: every field is copied into a column and the object dies
in the nursery. Parent object names arrive as one buffer of whole twenty-byte names rather than as an array of
arrays, so a merge costs the parser one slice and not three allocations.

### Resolving a parent without a string

The obvious mechanism is a `Map` keyed by the forty-character hex spelling of each object name. That is
exactly the allocation the store exists to avoid: one string per commit, one per lookup, plus the map's own
entries — megabytes of retained rope to answer a question the binary bytes already answer.

So `hash-index.ts` is **open addressing with linear probing over a single `Uint32Array`**. A slot holds
`rowIndex + 1`, which leaves `0` free to mean empty, and the key is never copied: it is read back out of the
store's own `hashes` column. The bucket is the object name's first four bytes used as they are, because a git
object name is already the output of a cryptographic hash and rehashing it would cost arithmetic to buy a
distribution it has. At the three-quarter load factor the table costs between five and eleven bytes per commit
and nothing else.

Git emits children before parents, so a parent is usually not in the store when its child arrives.
`pending-parents.ts` is a second hash table over the object names that are being waited for, chained through a
`next` column, and its entries are **freed when they resolve** and reused through a free list threaded down
that same column. That is what keeps it proportional to the width of the branch frontier — tens of entries —
rather than to the number of commits loaded, which would otherwise put twenty-four bytes per commit against a
ninety-six byte budget.

### Growing by five quarters, not by two

Doubling is the reflex and it is the wrong one here. The exact columns of one commit already cost 60 bytes of
the 96-byte budget, so a column doubled leaves up to 100 per cent of itself unused immediately after a growth:
120 bytes per commit before the parent table has been counted at all, and the budget broken by the allocator
rather than by the design. Five quarters caps the unused part at 25 per cent and is still geometric, so an
append stays amortised constant — each entry is copied four times over the whole life of the store, and never
once per append. The initial capacity is 4096, so an ordinary first page reallocates nothing.

`buildCommitColumns` returns **views** of exactly the contract's lengths rather than copies, so "Load More"
grows the same buffers instead of doubling them. The people table is snapshotted, so a page already built does
not change when the store is appended to again.

### What it measures

The store retains a **step function** of the commit count — the columns grow by five quarters, the hash index
doubles — so bytes per commit is that step divided by the count, and it has a maximum just after a growth and
a minimum just before the next one. The sizes below are chosen against those two cycles rather than for being
round, and none of them is a size the growth lands on exactly.

| measurement | value | where |
| --- | --- | --- |
| structural bytes per commit, 12 502 commits, the worst size the sweep below found | 85.519 | `perf/baselines.json` |
| structural bytes per commit, 20 000 commits, 22.1 per cent slack | 79.828 | `perf/baselines.json` |
| structural bytes per commit, 80 000 commits, 16.4 per cent slack | 76.416 | `perf/baselines.json` |
| the budget those are held to | 96 | ADR-0002 decision 6 |
| units of work per commit, at 80 000 | 13.792 | `perf/baselines.json` |
| work at 80 000 over work at 20 000 | 4.403 | `perf/baselines.json` |

### Where the worst size comes from, and what it obliges

12 502 is not read off a description of the curve. It is the result of a search, and **the search, not the
number, is what a later slice inherits.** Describing where the maximum ought to be has been tried twice and
missed twice — most recently by "the first size past a growth of all three retained structures at once",
which is a good account of where the peak tends to sit and still named a size 0.32 bytes per commit short of
the real one. At 12 502 only two of the three have just grown, and it wins on column slack anyway.

**The method, in two phases.** Phase one appends commits one at a time to 200 000, with the same synthetic
commits `build` uses, reading `retainedByteLength` after every append, and groups the counts by that total:
each distinct total is one plateau, and there are 24 of them over 4097 to 200 000. Counts below 4097 are
ignored, because below the initial capacity's first growth the fixed allocation dominates and the ratio says
nothing about the store. Phase two rebuilds candidates with the gate's own `build` and takes the maximum of
those. Phase one is a candidate generator and not an answer: because it gives every commit a parent, its
parent column is never smaller than the gate's, so its reading at any count is an **upper bound** on the
gate's reading at that count — which is what lets a whole plateau be discarded once its bound falls below the
best count already rebuilt, and what makes the pass exhaustive rather than a sample.

**The parent-column trap, which is why phase two is not optional.** `build` gives the last commit no parents,
so a store of `n` commits holds `n − 1` parent entries, and `parentIndices` grows on a boundary one commit
later than the per commit columns do. A one-pass incremental sweep cannot reproduce that — at every
intermediate `n` it has already given commit `n − 1` a parent — so it models the parent column as holding `n`
entries. The two agree everywhere except where `n − 1` and `n` fall either side of a parent-capacity boundary,
which is precisely the plateau starts, which are precisely the candidates for the peak. There the incremental
pass **overstates by one byte per commit**, the extra capacity being `4 × (new − old)` over `n`. The worked
pair: 12 501 reads 85.526 incrementally and **84.526** when rebuilt under the gate's workload, while
**12 502** reads **85.519**. One commit apart, a byte between them, and the peak in the other place.

**What changes when a growth constant does.** `INITIAL_COMMIT_CAPACITY` and the growth factor are the store's
own tuning knobs, and changing either moves every boundary of the curve. The size is then **re-derived by
re-running that search**, never adjusted, and the baseline is re-recorded with the new number and the reason
(`AGENTS.md` §11). The wording is under the same obligation: what is committed about 12 502 says what was
searched, over what range, and under which workload — this gate's synthetic one, of one parent per commit and
one author and one committer, message text excluded — and claims nothing past that, because a repository of
merges or of thousands of distinct people costs differently. At 85.519 the store is **10.48 bytes** under the
96-byte budget, and that is the whole of the headroom it has.

## The fifteen gates

| # | script | what it protects |
| --- | --- | --- |
| 1 | `gates:format` | Prettier in check mode |
| 2 | `gates:lint` | ESLint, type-aware, with the complexity and module-size limits, over the source and nothing a gate generated |
| 3 | `gates:boundaries` | the ring rules of ADR-0002 decision 1 |
| 4 | `gates:types` | the three TypeScript projects, separately |
| 5 | `gates:contract` | a committed snapshot of what `src/contracts/` exports |
| 6 | `gates:unit` | Vitest with per-directory coverage, and the fixture generator's determinism |
| 7 | `gates:mutation` | StrykerJS over `src/core/` and `src/contracts/`, refusing a run that measured nothing, refusing a survivor that is not on the committed list, and breaking below 85 as a backstop |
| 8 | `gates:build` | the three bundles |
| 9 | `gates:e2e` | Playwright over the built application |
| 10 | `gates:perf` | counters and budgets against committed baselines |
| 11 | `gates:size` | a byte budget on the built bundles |
| 12 | `gates:licences` | every installed licence on an allow-list |
| 13 | `gates:provenance` | no name of the extension's publisher or package |
| 14 | `gates:commits` | Conventional Commits, and no AI attribution |
| 15 | `gates:placeholders` | no note left for later, no skipped or focused test |

Three of them are written against a trap `AGENTS.md` §10 records, and each would look identical from outside
if it were doing nothing:

**`gates:placeholders` reads the working tree with `readdir`, never `git grep`.** `git grep` searches tracked
files only, so a grep gate run over new files before they are staged prints nothing — including for the file
that would have failed it. It reads code and configuration, not prose: `AGENTS.md` and the decision records
discuss placeholders by name, and a gate that fails on the contract that defines it is a gate that gets
switched off.

**`gates:commits` reads whole messages, not headers.** commitlint reads the header, and the co-author trailer
`AGENTS.md` §9 forbids lives in the body. The script also refuses a "generated with" line, a link to an
assistant and an emoji, over the range from the previous promotion's tag to `HEAD`.

**`gates:contract` asks the compiler, not the file.** It builds a program from `tsconfig.inner.json` and
records what the type checker resolves each export to, so a comment or a reordering does not move the
snapshot and a renamed field does. `npm run contract:record` rewrites it, which is the only way it changes.

**`gates:lint` reads the source and nothing a gate wrote.** `eslint .` walks the working tree, and an ESLint
`files` pattern is not anchored, so `src/**/*.ts` matches a copy of `src/` at any depth — including the copy
Stryker makes in `.stryker-tmp/sandbox-<id>/`, which carries a `// @ts-nocheck` on every `src/` and `test/`
file because that is Stryker's `disableTypeChecks` default, and which
`@typescript-eslint/ban-ts-comment` forbids. Measured in FIX-06 with one sandbox on disk and the ignore list
as it stood: **1674 errors, every one of them inside `.stryker-tmp/`**. So the ignore list covers every
directory that exists only because a gate ran — the Stryker temporary directory, `reports/`,
`playwright-report/`, `test-results/` and the generated fixture repositories — each of which is a
`.gitignore` entry too, so none of them can hide a committed file. With them the gate reads **91 files**,
which is exactly the tracked files its patterns cover. It cannot bite inside `npm run gates`, where lint is
gate 2 and mutation is gate 7; it bites whoever runs the two at once, which is what an hour-long gate invites.

### Coverage

Coverage thresholds are **per directory**. `src/core/**` and `src/contracts/**` are both held at 100 per cent
of statements, branches, functions and lines, which is what their own tests reach; `app/`, `preload/` and
`ui/` are wiring, their guarantee comes from the end-to-end gate, and holding them to a number would buy a
test that asserts the wiring is wired.

`src/contracts/**` was thresholded in FIX-06, when the ring stopped being declarations only: S08 moved the
page decoders into it, and a ring that can be wrong needs a floor. The rest of that ring has no executable
code, and the v8 provider reports such a file as **100 per cent of a zero denominator**, so it neither raises
nor lowers the number — measured over the twelve files the provider reports under `src/contracts/`
(`index.ts` is excluded, as every barrel is), of which three carry no statement at all. The whole group is
35 statements, 11 branches, 9 functions and 34 lines, and the decoders are 27 of those statements. Deleting
the two tests that reach `entryAt`'s refusal takes the group to 97.14, 90.9 and 97.05 and fails the gate,
which is how the floor was proved to bite rather than merely to be recorded.

## The mutation gate

Stryker runs through its **command runner**, not through `@stryker-mutator/vitest-runner`. At the pinned
versions the vitest runner's per-test name filter does not survive the round trip into its worker: no test
matches, no test runs, and every mutant is reported as having survived. Measured again over
`src/core/parse/raw-date.ts` after the gate was repaired: **score 0.00, 71 of 71 survived**, `Ran 0.00 tests
per mutant on average`, and **no error raised** — the number is wrong and the run looks healthy.
`docs/ADR-0003-quality-gates-and-ci.md` decision 3 carries the amendment. The command runner runs the whole
unit suite once per mutant, which is slower and correct, and selects the live mutant through
`__STRYKER_ACTIVE_MUTANT__` in the child's environment rather than through the file on disk.

One consequence is that the unit suite is split in two: `vitest.config.js` covers `src/` only, because the
mutation gate runs it once per mutant, and `vitest.fixtures.config.js` covers the fixture generator's proof,
which spawns git some seventy times and belongs nowhere near that loop.

### A timeout is scored as a kill, and that made this gate green for nothing

**Stryker counts a mutant that ran out of time as detected.** That default is right — a mutant that makes the
code loop forever has been caught — and it is how this gate came to report **100.00 with nine of 1131 mutants
killed by a test**, through four lanes and four audits, while the share of its detections that were timeouts
climbed from ten per cent to ninety-nine.

The cause is a calibration, not a bug in any test. Stryker's per-mutant budget is the **dry run's** net time
times `timeoutFactor` plus `timeoutMS`, and the dry run has the machine to itself while the per-mutant runs
share it with six others: `concurrency` defaults to one less than the processor count, which is seven here.
Measured on the development machine (`docs/ADR-0001-stack.md`), one `vitest run` over `src/` costs **2.0 to
2.4 seconds** alone and **12.0 to 13.3 seconds** when seven run at once — against a budget of
`2.5 s × 1.5 + 10 s`, or **13.8 seconds**. Almost every per-mutant run therefore exceeded it, and every one
that did was scored as a kill.

So `timeoutMS` is **60 000**, which puts the budget at about 64 seconds against a run that costs eleven, and
the per-mutant command passes `--fsModuleCache`. The cache is a speed choice and not the correctness one:
enabling it takes the concurrent cost from 13.2 to 11.0 seconds, and **on its own it left 58 of one module's
71 mutants still timing out**. Sharing a transform cache between sandboxes is sound because the instrumenter
writes **one** instrumented source carrying every mutant, so the file keyed on is identical for every mutant
of a run; Vitest's cache key is the module id plus the file's whole content, and Stryker symlinks
`node_modules` into each sandbox, so the default cache path already resolves to one directory outside them.

### What the gate refuses beyond the score

A score composed of timeouts is not a measurement, and the score alone cannot say so. **`gates:mutation` is
therefore `scripts/gates/mutation.js`**, which runs Stryker, reads back the shape of the run from its json
report, and refuses two shapes whatever the score says:

- **a mutant reported as killed or survived with no completed test run behind it.** Both verdicts are claims
  about what the tests did, and this runner reports exactly one completed test per mutant whose suite reached
  an exit status. This is the clause that catches a runner returning verdicts without running anything, which
  is what the vitest runner above does.
- **a run more than a quarter of whose detections are timeouts.** This is the clause that catches the failure
  described above. A quarter is a validity bound rather than a baseline: the honest run measures **3.8 per
  cent**, and the four runs that reported 100.00 while the gate measured nothing sat at 10, 62, 82 and 99.6.

Neither clause is the tests-per-mutant figure itself, because a genuinely non-terminating mutant is a
legitimate detection with no test result — 43 of the 1131 mutants are loop-control mutations in the growth and
probing loops of the store and of the layout engine, and in the UTF-8 decoder, which is why the honest run
prints `Ran 0.96 tests per mutant on average` rather than 1.00. Both numbers are **printed on every run**,
beside the breakdown, because
what made the failure survive four reviews was that the line Stryker already printed was read by nobody.

**Every later slice's mutation run has to satisfy this**, so: a lane whose run is refused has not failed on
its tests. It is being told that the run cannot support a claim about them, and the two numbers in the
refusal say which of the two shapes it hit.

### Every run is a full run

`incremental` is **off**, and `.github/workflows/ci.yml` restores nothing. Incremental mode reuses the
verdicts of an earlier run for any mutant whose file it believes unchanged, and **S03 measured it** reusing
them when it should not have — a run reporting 47 survivors at 95.26, then an incremental re-run finishing in
47 seconds with the same survivor counts although the tests had changed, then a full run reporting 100.00
with none. That is S03's measurement and FIX-06 did not reproduce it; what FIX-06 did was remove the
mechanism, so there is nothing left to reproduce it against.
FIX-04's shape check refuses a restored run made of timeouts, which closes the green-for-nothing path;
it cannot notice a run that is fast and wrong in the other direction, because the report's shape is the shape
of whatever was reused.

The cache made that worse rather than contained it: the key was the lockfile, which does not change when the
source does, and a `restore-keys` prefix beneath it, so a pull request could be scored against a report
produced from other source. Its benefit was a **second** run of the same source, which is the one case the
one workflow does not have: `concurrency` cancels a superseded run, `push` fires once per commit, and the
promotion pull request is opened once. That is read off `.github/workflows/ci.yml` and ADR-0003 decision 6,
not measured — **the workflow has never run, because nothing has been pushed.** What a cold run costs with
the cache and without it is therefore an **inference** and not a measurement, and it is the same inference
either way: an empty cache restores nothing and the run is full.

The alternative considered and rejected was keeping incremental mode and keying the cache on the source tree
rather than the lockfile. It fixes the key and not the mechanism: the verdicts reused are still verdicts a
different run produced, and the shape check cannot tell a reused one from a fresh one. A gate that takes an
hour and is right is cheaper than one that takes a minute and might be a month old. What FIX-06 measured, and
the only cost it can honestly claim, is the wall clock of a full local run, in the table below.

### The numbers it produces

Two runs, over two scopes, on the development machine and otherwise idle. The first is **S02's**, over
`src/core/**/*.ts` without the tests, at S02's own commit; it is kept as S02 wrote it and FIX-06 did not
re-run it. The second is **FIX-06's**, over that scope plus `src/contracts/**/*.ts` without the tests, with
`incremental` off, at the commit that widened it. The source tree grew between them, so the two are not a
before-and-after of the same code.

| measurement | S02, `src/core/` | FIX-06, `src/core/` and `src/contracts/` |
| --- | --- | --- |
| files in the report | 17 | 20 |
| mutants | 1131 | **1195** |
| killed by the suite | 1081 (1080 to 1081) | 1141 (1141 to 1142) |
| timed out | 43 (43 to 44) | 46 |
| survived | 7 (6 to 7) | 8 (7 to 8) |
| no coverage, errors, ignored, pending | 0 | 0 |
| score, against `break` 85 | **99.38** (99.38 to 99.47) | **99.33** (99.33 to 99.41) |
| timeout share of detections | 3.8 per cent | 3.9 per cent of 1187 |
| the line Stryker prints | `Ran 0.96 tests per mutant on average.` | the same, 0.96 |
| `gates:mutation`, wall clock | 53 minutes | 62 to 63 minutes |
| `npm run gates`, wall clock | 55 minutes | 65 minutes |

S02's column is one run, the last of three; where the three disagreed the range is given, because two mutants
sit either side of the timeout budget and move between runs. FIX-06's column is two runs of **identical
source**, the first `gates:mutation` alone and the second inside `npm run gates`, and they disagree about one
mutant — see below. The two wall clocks are **not** a cost for the widening: they are different commits with
different amounts of source, and 57 more mutants at about eleven seconds each over seven workers accounts for
about a minute and a half of the nine minutes between them.

**What the widening added is exactly three files and 57 mutants.** At FIX-06's commit the `src/core/` part of
the report holds 1138 mutants across 17 files, which is what `stryker run --dryRunOnly` counts before the
change as well; `src/contracts/` adds `commit-columns.ts` with 50, `column-read.ts` with 6 — the 56 the
decoders carried in `src/core/store/` before S08 moved them — and `bridge.ts` with 1. Every other file of
`src/contracts/` is type declarations and produces none, which is why widening a whole ring adds 5.0 per cent
to the mutant population rather than a proportion of its file count.

Eight survivors. Seven are in `src/core/parse/`: `bytes.ts` at 60:26, 70:7 and 166:20, `commit-lookup.ts` at
28:62, `object-names.ts` at 51:78, and `working-tree-status.ts` at 141:7 and 141:20. The eighth is the one the
widening found: **`src/contracts/bridge.ts` at 13:35, `StringLiteral`**, which replaces
`BRIDGE_GLOBAL_NAME`'s `'gitGraphical'` with the empty string. No unit test names that constant — grepped,
not assumed; the gate that does is `gates:e2e`, which asserts the bridge from inside the renderer, and
Stryker runs the unit suite only. **Both decoder modules score 100.00 with no survivor**, in both runs.
Every other file under `src/core/` scores 100.00; those four score 97.32, 97.92, 98.75 and 97.53. **Closing
any of them is test work in the folders their own lanes own, and it is not what moved the instrument.**

### A kill under the command runner is "the suite exited non-zero"

That eighth mutant is the one the two runs disagree about, and the disagreement is worth more than the
mutant. Run one reported it **survived**; run two, over identical source, reported it **killed**, which is the
whole of the difference between 99.33 and 99.41. Re-run on its own — `stryker run --mutate
src/contracts/bridge.ts`, one mutant, the suite completing at `Ran 1.00 tests per mutant` — it **survives**.
Nothing in the unit suite reads the constant, so there is nothing that could have detected it, and the honest
verdict is the isolated one.

What run two saw was the suite exiting non-zero for a reason that was not the mutant. The command runner has
no way to tell those apart: it runs `vitest run` and reads an exit status, so **any** failure under seven
concurrent workers — and not only a failing assertion — is scored as a detection. That is the same family as
the timeout counted as a kill, and it moves the score in the same direction, but it is smaller and it is not
what `scripts/gates/mutation.js` refuses: a falsely killed mutant carries a completed test run, so the first
clause passes it, and one of 1195 is nowhere near the timeout cap. **Two consequences for a lane reading its
own numbers:** a survivor that appears in one run and not the next is a survivor, not a flake, until an
isolated run says otherwise; and a score is reproducible to about a tenth of a point on this machine, not
exactly.

`bytes.ts:166:20` is the one to read twice, because it was reported as survived on two runs of three and as
timed out on the third, where the machine was busier — and a timeout is a detection. FIX-06 read that as a
**slow** mutant. **FIX-07 measured it and it is not slow: it is equivalent.** `at < units.length` mutated to
`<=` runs the batching loop one extra time and appends `String.fromCharCode()`, the empty string, so the
decoded text is unchanged — identical output at lengths 0, 1, 2, 4095, 4096, 4097, 8192 and 8193, either side
of the 4096 batch. One extra empty iteration cannot exhaust a 64-second budget, so a `Timeout` verdict for it
is the machine being busy and not the mutant looping, and the honest verdict is that it survives. The score
above is therefore a ceiling and not a point. The remedy is still a longer budget, and it is still deliberately
not applied on top of the one FIX-06 set: a budget is a committed number and moving it twice, once on a
measurement and once on a hunch, is how a baseline gets walked.

### The survivor baseline, and why `break` stayed at 85

**The score threshold cannot fail at this size, and that is arithmetic rather than an opinion.** `break`
compares one global number: over the 1195 mutants of the configured scope a score below 85 needs
`(1195 − S) / 1195 < 0.85`, so **180 survivors** — and the largest single file in scope,
`src/core/layout/lane-layout.ts`, carries **140 mutants**. Deleting the tests of the largest file in the
project would therefore read 88.28 and **pass**. Measured on this scope rather than argued: reducing
`src/core/parse/raw-date.test.ts` to one test that asserts nothing takes that file to **66.20 with 24
survivors** and the whole run to **97.32**, which is twelve points above `break` and which both of FIX-04's
shape clauses also pass. FIX-04 measured the same shape one scope earlier — 1131 mutants, 170 survivors
needed, 133 in the largest file — and the numbers moved with the scope while the conclusion did not.

**Raising the threshold is not the repair.** The honest run sits at 99.33, fourteen points above 85, so any
new number is a guess at how much honest variation to allow; a number close to 99.33 would flap, because a
kill under the command runner is only "the suite exited non-zero", and `docs/ADR-0003-quality-gates-and-ci.md`
decision 5 does not let a threshold be relaxed once set. So `break` is **kept at 85 and not moved**: it is
Stryker's own message, it costs nothing, and it catches the collapse that the list below would otherwise
report as hundreds of lines. It is the backstop. The ratchet is the list.

**The ratchet is `scripts/gates/mutation-survivors.json`**, one committed entry per mutant known to survive,
each with the reason it survives and which of four kinds it is: a **test gap** a behavioural assertion would
close, **diagnostic text** where only a thrown message changes, **not behavioural** where every observable
answer is identical under the mutant, and **another gate** where the mutant is observable only from a ring the
unit suite does not cover. **Eight entries** at the commit that introduced it, which are the same eight the
paragraphs above name — three in `bytes.ts`, two in `working-tree-status.ts`, one each in `commit-lookup.ts`,
`object-names.ts` and `src/contracts/bridge.ts` — reproduced there rather than carried over. The one reading
in this document that the re-measurement changed is `bytes.ts:166:20`, which the paragraph above now records
as equivalent rather than slow.

**Three full runs of identical unmodified source at that commit, and they do not agree.** Two report those
eight survivors at 99.33 — 1143 killed and 44 timed out in 63 minutes, then 1141 and 46 in 68 — differing in
exactly two verdicts, both in `reference-list.ts` and both between `Killed` and `Timeout`, which is a
detection either way. The third reports **seven** survivors at **99.41**: `bytes.ts:166:20` came back
`Killed`, and it cannot have been killed, because the mutant is equivalent and no assertion can distinguish
it. What the command runner saw was the suite exiting non-zero for a reason that was not the mutant, which is
the same family as a timeout scored as a kill. **That is why a listed mutant coming back detected is reported
and not refused**: the clause that refused it would have failed this very run, on an unmodified tree with a
correct list, and `AGENTS.md` §11 calls a gate that flaps a defect of the gate. It is also why a lane should
read the survivor list rather than the third decimal of the score: 99.33 and 99.41 are the same tree.

`scripts/gates/mutation.js` reads that list beside the two clauses FIX-04 built, and splits what it finds by
whether the fact is deterministic:

- **A survivor that is not on the list refuses the build.** This is what catches the first new survivor in a
  file of any size, which is what a per-file percentage floor cannot do: a floor of 95 would let a 140-mutant
  file accumulate seven survivors in silence. The message names the mutant and says that a new survivor is
  either a test to write or an entry to add with a reason, and that adding one is a commit a reviewer reads.
- **An entry that matches no mutant at all, in a file the run did mutate, refuses the build.** The mutant
  population is a pure function of the source, so this is deterministic and can refuse without flapping. It is
  the case that turns an allow-list into a blanket — a coordinate protecting nothing that nobody is checking —
  and when an unlisted survivor of the same file carries the same mutator and replacement, the message says so
  and names the line it moved to, because that is what an edit above a listed line looks like.
- **An entry whose mutant the run reports as detected is printed, and does not refuse.** That verdict is not
  deterministic: any non-zero exit of the suite counts as a detection, so a busy machine can turn a survivor
  into a kill, and `AGENTS.md` §11 says a gate that flaps is a defect of the gate. The line says what to do
  instead — an entry whose mutant a test now kills is dropped in the commit that wrote the test, which is the
  list shrinking, which is the one direction §11 lets a baseline move on its own.
- **Entries in a file the run did not mutate are out of consideration**, and counted as such. Narrowing
  `--mutate` for speed therefore removes entries from the question rather than diluting a percentage, so a
  scoped lane's answer stays exact. Measured: `--mutate src/contracts/column-read.ts` passes in 71 seconds
  with all eight entries out of scope.

**The comparison is the whole of the guarantee, so it is exact:** an entry matches a mutant on file, line,
column, mutator **and replacement**, all five. Four are not enough, measured on the recorded run: 187 positions
carry more than one mutant with the same file, line, column and mutator, and two of them are on the list — at
`working-tree-status.ts` 141:7 the `ConditionalExpression` replacing the condition with `true` is killed while
the one replacing it with `false` survives, and at `bytes.ts` 70:7 `lead >= 0xc2` is killed while
`lead <= 0xc2` survives. An entry naming only the position would excuse the killed twin as well, which is a
blanket one mutant wide. Nor are five a unique key: 12 of the 1195 mutants share all five with another, all of
them a `ConditionalExpression` Stryker emits twice where a compound condition is mutated once whole and once in
part, all killed and none on the list. The gate counts mutants rather than entries so that its survivor count
is the one Stryker printed three lines above it. Stryker's own mutant `id` would be unique and is not used: it
is positional, so it would move under any edit anywhere in the file, which is the flapping this identity
exists to avoid. The cost that remains is that an edit above a listed line moves it and the entry then names
nothing — the second clause above — and the repair is to re-record that entry, never to add a second one.

**Every later lane's audit reports the list's length and any change to it**, which is the breakdown
`AUDIT_TEMPLATE.md` asks of a gate that reports a score. The gate prints the length, how many entries matched a
mutant of the run, how many of those were detected rather than left alive, how many were out of scope and how
many survivors were unlisted, on every run, pass or fail — because the failure this gate exists to undo
survived four reviews by being printed and read by nobody.

So a lane reads its own per-file line and its own survivors, not the headline, and the headline's job is to
stop a collapse rather than to notice a module.

The repair did not make the gate faster and was not expected to either way: the same scope at the same commit
took 52 minutes before it, spending almost all of that on 1122 timeouts of about 14 seconds. Replacing them
with 1081 runs that complete in about 11 left the wall clock where it was, within a minute and a half, and the
whole of `npm run gates` went from 54 minutes to 55.

## The fixture repositories

`test/fixtures/specification.json` is the recipe; the repositories are generated into
`test/fixtures/repositories/`, which is ignored. A repository inside a repository is a submodule waiting to
happen, and the recipe is the part worth keeping. `npm run fixtures` builds them.

Eight shapes, because wave 3 needs them: a linear history; a branch and a merge; two roots joined; a
lightweight tag and an annotated one; a stash; a detached HEAD; a dirty working tree with an untracked file;
and one history of ten thousand commits, written through `fast-import` because ten thousand `git commit`
invocations are ten thousand processes.

A commit's object name hashes its tree, its parents, both identities, both timestamps and its message, so the
generator inherits nothing: eight environment variables an operating system needs to start a process, every
git variable set explicitly, the system and global configuration switched off rather than overridden, and
`HOME` pointed inside the fixture directory so a profile `.gitconfig` cannot be read even by a code path that
ignores the rest. `core.autocrlf` and `core.eol` are set for the same reason — a checkout that rewrites line
endings writes a different blob, and a different blob is a different tree and a different object name.

`test/fixtures/expected-object-names.json` records what a correct generation produces: every reference in
full, and the commits as a count and a digest, because ten thousand object names would be four hundred
kilobytes of diff nobody can read. `npm run fixtures:record` rewrites it. The test compares a fresh generation
against that file — which is the half that catches a machine — and separately generates two shapes twice and
compares them with each other, which is the half that catches the generator.

## The end-to-end gate, and why it is three tests

Wave 1's reviews found four ways this application can be broken or unsafe while **every static gate passes**,
each demonstrated by probe: the window configured with `contextIsolation: false`, `sandbox: false`,
`nodeIntegration: true`; the preload bundled as an ES module, which Electron's sandboxed loader refuses by
name; the bridge exposed under a name the contract does not define; and a re-export deleted from the contract
index.

So: the window opens and shows the empty state; the sandbox is real, asserted from inside the renderer, with
`window.require`, `window.process` and `window.module` all `undefined` and the bridge carrying exactly the
methods `CHANNELS` names; and nothing is logged as an error while the renderer starts. Tests 1 and 3 catch the
blank-window pair, test 2 catches the first, and the contract gate above catches the fourth. Every Electron
process the suite starts is stopped by the suite, and the exit status is read back afterwards, because a
leaked process is a failure whatever the assertions said.

## The performance gate, and the ratchet

`docs/ADR-0003-quality-gates-and-ci.md` decision 4: wall-clock time on a shared runner is noisy enough to
flap, and a gate that flaps is a gate people learn to ignore. So the gate asserts **counters** — bytes
retained per commit, units of work per commit, and the ratio of work at eighty thousand commits to work at
twenty thousand — and records the wall clock beside them with an order-of-magnitude tolerance.

The scaling ratio is what catches an accidentally quadratic append regardless of machine speed. It is 4.403
rather than exactly 4, and the store does **about four times the work for four times the commits**: a
quadratic append would be 16 or more, and the ceiling is 8.

**Where the gate measures is part of what it measures.** The two growth cycles put a best and a worst point
on the curve, and a size picked for being round can land on either. `INITIAL_COMMIT_CAPACITY × (5/4)ⁿ` is
8000, 10 000 and 12 500, so at those three sizes the last growth lands exactly on the data and the columns
carry no slack at all — the cheapest point of the whole curve. That is the dominant reason the pair 10 000 and
40 000 read 6.019 rather than about 4.3, and it is a much larger effect than the initial capacity of 4096
absorbing proportionally more of the smaller build: 12 500 is far from 4096 and still reads 5.611 against
50 000, because it too is capacity-exact.

So the gate asserts at the worst size the sweep above found and at two ordinary mid-cycle sizes, and it
**refuses a capacity-exact one**: for every size it measures it checks that the builder's final capacity is
strictly greater than the commits appended, prints the observed slack beside each number, and fails naming the
size if one stops carrying slack. Without that check a later change to either growth constant would move a
size onto a boundary and invite the ratchet to be re-anchored to the lowest number the store can show — as an
improvement, in a green run. The two commits between 12 500 and 12 502 are the whole of the margin here:
12 500 is capacity-exact and reads 70.532 against 12 502's 85.519.

`perf/baselines.json` is committed, and the comparison is written so that a baseline can only be **beaten**: a
run worse than the committed number fails, a run better than it prints the number to commit, and a run past a
`ceiling` — a budget from ADR-0002 decision 6 — fails whatever the baseline says, so a baseline cannot be
walked up past its budget one commit at a time. There is deliberately no flag that rewrites the file: editing
it by hand is what puts the new number inside the diff a reviewer reads.

## One workflow

`.github/workflows/ci.yml`, and there is exactly one. Every trigger lives in it — pull request, push to `dev`
and `main`, manual dispatch — because Actions renders one row per workflow run with jobs nested inside it, so
a second file is a second row for the same commit and an orphan.

```
build ─┬─ static   (format, lint, boundaries, types, contract, licences, provenance, commits, placeholders)
       ├─ unit     ─── mutation
       ├─ e2e      (windows)
       ├─ perf     (windows)
       └─ size
                   └─ gate (needs all of the above, and is the single required check)
```

Concurrency cancels superseded runs for the same reference. Every job calls a `gates:*` script and never a
command of its own, so what runs there is what an executor ran in its worktree. `node_modules` is not passed
between jobs — with the Electron runtime in it, it is over half a gigabyte — so each job restores the same
cached npm store instead; only `dist/` is published as an artifact.

**Branch protection is a repository setting**, and making `gate` the required check is the owner's to do
(`AGENTS.md` §2). The workflow works without it; the requirement is what makes it binding.
