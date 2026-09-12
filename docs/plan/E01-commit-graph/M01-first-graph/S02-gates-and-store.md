# E01-M01-S02 · The gate pipeline, the commit store and CI

What a reader of the code needs to know about the fifteen gates, the one workflow, and the first real module
of `src/core/`.

## What exists now

Nothing a user sees has changed: the application still opens one window and says `No repository is open.`
What has changed is everything around it. `npm run gates` now runs **fifteen** gates rather than five, in the
order `docs/ADR-0003-quality-gates-and-ci.md` §2 puts them, and `.github/workflows/ci.yml` calls the same
scripts. Under `src/core/store/` there is the columnar commit store the whole of wave 3 consumes, held to a
hundred per cent mutation score and a ninety-six byte per commit budget that a benchmark measures on every run.

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

| measurement | value | where |
| --- | --- | --- |
| structural bytes per commit, 10 000 commits | 66.612 | `perf/baselines.json` |
| structural bytes per commit, 40 000 commits | 78.099 | `perf/baselines.json` |
| the budget those are held to | 96 | ADR-0002 decision 6 |
| units of work per commit | 13.368 | `perf/baselines.json` |
| work at 40 000 over work at 10 000 | 6.019 | `perf/baselines.json` |

## The fifteen gates

| # | script | what it protects |
| --- | --- | --- |
| 1 | `gates:format` | Prettier in check mode |
| 2 | `gates:lint` | ESLint, type-aware, with the complexity and module-size limits |
| 3 | `gates:boundaries` | the ring rules of ADR-0002 decision 1 |
| 4 | `gates:types` | the three TypeScript projects, separately |
| 5 | `gates:contract` | a committed snapshot of what `src/contracts/` exports |
| 6 | `gates:unit` | Vitest with per-directory coverage, and the fixture generator's determinism |
| 7 | `gates:mutation` | StrykerJS over `src/core/`, breaking below 85 |
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

### Coverage, and the mutation threshold

Coverage thresholds are **per directory**. `src/core/**` is held at 100 per cent of statements, branches,
functions and lines, which is what the store's own tests reach; `app/`, `preload/` and `ui/` are wiring, their
guarantee comes from the end-to-end gate, and holding them to a number would buy a test that asserts the
wiring is wired. The mutation threshold breaks at **85** for `src/core/` and the store scores **100** over 325
mutants, 296 killed outright and 29 by timeout.

Stryker runs through its **command runner**, not through `@stryker-mutator/vitest-runner`. With `vitest@5.0.0`
the vitest runner's per-test name filter does not survive the round trip into the worker: no test matches, no
test runs, and every mutant is reported as having survived with a score of zero — a red gate whose number
means nothing. The command runner runs the whole unit suite per mutant, which is slower and correct. The
consequence is that the unit suite is split in two: `vitest.config.js` covers `src/` only, because the
mutation gate runs it hundreds of times, and `vitest.fixtures.config.js` covers the fixture generator's proof,
which spawns git some seventy times and belongs nowhere near that loop.

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
retained per commit, units of work per commit, and the ratio of work at forty thousand commits to work at ten
thousand — and records the wall clock beside them with an order-of-magnitude tolerance.

The scaling ratio is what catches an accidentally quadratic append regardless of machine speed. It is 6.019
rather than exactly 4, because the initial capacity of 4096 absorbs proportionally more of the smaller build
than of the larger one; a quadratic append would be 16 or more, and the ceiling is 8.

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
