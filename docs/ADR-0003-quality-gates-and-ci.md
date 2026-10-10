# ADR-0003 · Quality gates, the regression ratchet, and one grouped CI workflow

**Status:** **approved** by the owner on 2026-09-11, together with `docs/PLAN.md` and the other decision
records (`AGENTS.md` §2).

**Date:** 2026-09-11

**Closes:** open item 7 of `docs/INPUTS.md` (whether there is CI, and the shape of the pull request).

## Context

The owner asked for three things that are one thing: the usual quality gates, **mutation testing** on top of
them, and a guarantee that **what has been delivered does not regress later**. He also asked that continuous
integration appear as **one line per pull request** in GitHub Actions, which expands into every job and gate,
with nothing running separately and orphaned.

`AGENTS.md` §7 already says a gate is not evidence until it has been watched failing, and makes the reviewer
mutate a line the executor did not. That is a per-slice, human-scale argument. It does not survive twenty
milestones: a guarantee proven in milestone one has nobody watching it in milestone twelve. **A ratchet is
what survives**, and a ratchet is a committed baseline plus a job that refuses to let it slip.

## Decision 1 · One gate script, run identically everywhere

There is a single entry point. `npm run gates` runs every gate below in order, and **CI calls the same
scripts**, never its own inlined commands. A gate that exists only in a workflow file cannot be run by an
executor in a worktree, and a gate an executor cannot run is a gate that blocks at the wrong moment.

This matters because of `AGENTS.md` §2: **executors never push**, so CI never sees a lane branch. The
primary evidence is local, produced in the lane and recorded in the audit. CI is the **ratchet on `dev` and
`main`**, which run only when the owner asks for a push, and the promotion pull request. The two must
therefore be the same commands, or the ratchet checks something the lane never ran.

> **Amended 2026-10-09, by the owner's ruling.** There is still one family of scripts and CI still calls
> them, but a lane no longer runs all of them whatever it changed. In the first milestone every lane ran every
> gate; the mutation gate took 88 minutes in E01-M01-FIX-28's last full run (2026-10-04), and the lanes that
> only corrected documents or comments paid it for nothing. So the entry point has **tiers** — `gates:static`,
> `gates:quick` and `gates` — and the task file names the tier its lane runs, as a boundary. The **wall-clock
> budgets of decision 4 are their own gate, `gates:budgets`**, outside every tier and run on a free machine:
> run seconds after the mutation gate, one of them went red on an unchanged product in the same lane's runs.
> The reviewer runs everything at the reviewed commit, every round. `AGENTS.md` §11 holds the rule, and
> E01-M01-S11 lands the scripts and says what each holds.

## Decision 2 · The gates

Ordered cheapest first, so a failure is reported in seconds rather than minutes.

| # | gate | script | what it protects |
| --- | --- | --- | --- |
| 1 | Format | `gates:format` | Prettier in check mode. Diffs stay about the change. |
| 2 | Lint | `gates:lint` | ESLint with typescript-eslint, type-aware rules, complexity and module-size limits (ADR-0002 decision 7). |
| 3 | **Boundaries** | `gates:boundaries` | `dependency-cruiser` enforces the dependency rule of ADR-0002 decision 1. `core/` reaching for Electron, Node or the DOM fails here. |
| 4 | Types | `gates:types` | `tsc --noEmit`, strict, across every process. |
| 5 | Contract | `gates:contract` | The IPC and data contracts in `contracts/` are checked for accidental change: a committed shape snapshot must match. Changing it is allowed, silently changing it is not. |
| 6 | Unit | `gates:unit` | Vitest, with per-directory coverage thresholds. `core/` is held high; `app/` is wiring and is held low on purpose. |
| 7 | **Mutation** | `gates:mutation` | StrykerJS, through its command runner. See decision 3 and its amendment. |
| 8 | Build | `gates:build` | esbuild produces main, preload and renderer bundles. |
| 9 | End to end | `gates:e2e` | Playwright drives the built Electron application on fixture repositories. This is `AGENTS.md` §7's "open the actual thing", made repeatable. |
| 10 | **Performance** | `gates:perf` | Counters and budgets against committed baselines. See decision 4. |
| 11 | Size | `gates:size` | Bundle and installer size budget over the **production** build, so the distributable does not drift upward unnoticed, **plus a committed manifest of the modules in each bundle**, which the byte count cannot replace. See below. |
| 12 | Licences | `gates:licences` | Every dependency's licence is on an allow-list of permissive licences. The repository is public and MIT; a copyleft dependency arriving transitively is caught here, not by a stranger. |
| 13 | Provenance | `gates:provenance` | A weak, mechanical companion to `AGENTS.md` §1: no dependency, file name or committed string referring to the extension's package or publisher. It cannot prove a clean room. The reviewer's reading of the diff remains the real check. |
| 14 | Commits | `gates:commits` | Conventional Commits over the range, and **no AI attribution of any kind** (`AGENTS.md` §9), which is otherwise a rule only a human remembers. |
| 15 | Placeholders | `gates:placeholders` | No `TODO`, stub, skipped or focused test in the changed files (`AGENTS.md` §6.7). Runs over the working tree, not `git grep`, because `git grep` sees only tracked files (`AGENTS.md` §10). |

Gates 1 to 8 and 11 to 15 run on any platform. Gate 9 and 10 run on Windows, the verified platform
(ADR-0001).

**The size gate weighs the production build, and has a second instrument beside the byte count.**
Decided 2026-09-13 and implemented by E01-M01-FIX-12. Every number below was measured by a lane or by a
review and is attributed to whoever took it; I have taken none of them myself. The development build stays
unweighed and unbudgeted.

**Why the change.** A size budget exists to keep the distributable from drifting upward, and the
distributable is the production build. Weighing the development build makes a doc comment in a module a
bundle reads spend that bundle's budget. E01-M01-FIX-11 measured one type's two documentation blocks at
1 748 bytes of source against a whole renderer budget of a few kilobytes, and review round 11 measured a
stand-in renderer that merely reads the existing decode API, with no row recycler and no canvas, at **6 520
development bytes against a 3 072 budget** — over budget by more than its whole budget, before a line of
rendering is written, entirely from prose. **That is a gate that pays an author to delete the explanation of
why the code is the way it is**, in a project whose discipline is writing that down, while every other gate
stays green.

**What the change gives up, which an earlier draft of this paragraph got wrong.** It claimed nothing was
lost, reasoning from FIX-11's finding that minification never drops unread constants. The finding is true
and was reproduced. The inference was false. Review round 11 measured the regression this gate was used to
catch as **+4 702 bytes in development and +76 in production**, and showed that this project's own margin
rule over a production build leaves that regression **1 129 and 1 844 bytes of room to pass silently**. A
production-only byte count would not have caught it. What is given up is the only instrument that saw it.

**So the byte count is not enough on its own, and a second instrument replaces what it loses.** A committed
manifest of which modules contribute code to each bundle, refused on addition **and on staleness**, in the
manner of the survivor baseline (decision 5). It catches "the whole contract ring came back" at **zero bytes
of drift**, and it is completely insensitive to prose, which is the property the byte count cannot have.

Its source is the bundler's own module graph, read through a supported interface, **not the comment markers
an earlier draft of this paragraph named.** E01-M01-FIX-12 measured those markers wrong twice over: a marker
marks a contiguous run rather than a module, so counting them counts the wrong thing, and the counts quoted
here were taken from a tree two lanes out of date. The module graph is reported for the production build as
well as the development one, so the manifest reads **what ships** rather than a proxy for it, and the same
call yields a per-module byte table that two separate lanes had each been assembling by hand.

**What the manifest still cannot see**, measured rather than assumed: a module whose entire contribution
folds into a constant leaves no trace in the production graph at all. That gap is recorded beside the
manifest, with the instance that demonstrated it.

## Decision 3 · Mutation testing with StrykerJS

> **Amended 2026-09-12, after E01-M01-S02.** The tool is still StrykerJS, but **not through its Vitest
> runner**. At the versions this project pins, `@stryker-mutator/vitest-runner` 10.0.0 against `vitest` 5.0.0
> reports a score of zero with every mutant surviving and no test run per mutant, and it does so **without
> erroring** — the exact shape of failure this whole document exists to prevent, and one that would have read
> as "the tests kill nothing" rather than "the runner is broken". S02 diagnosed it to the runner's test-name
> pattern not surviving the round trip into its worker, and runs Stryker through its **command runner**
> instead: slower, correct, and no dependency added or changed. Revisit when the two versions line up. The
> paragraph below is kept as written because the reasoning for choosing StrykerJS is unchanged.

**Tool: StrykerJS**, with `@stryker-mutator/vitest-runner`. It is the fastest to adopt for this stack: it
reads the existing Vitest configuration, needs one configuration file, and requires no change to a single
test. The owner named it, and nothing here argues against it.

- **Scope: `core/` and `contracts/`.** These hold every decision that can be wrong, and they are pure, so
  their tests are fast enough for mutation to be affordable. The parsers live in `core/` and the decoders in
  `contracts/`, so both are covered (ADR-0002 decision 3, amended). The renderer, the adapters and the
  composition root are excluded: mutating wiring and process handling produces mostly equivalent mutants and
  long runs, and their guarantee comes from the end-to-end gate instead. **A lane may run over less than that
  scope, but only a scope its task file names** (`TASK_TEMPLATE.md`), because narrowing which files are
  mutated never changes which tests run, while an executor choosing its own scope can narrow until the result
  flatters it. The wave-end review runs the configured scope in full.
- **The ratchet is a committed survivor baseline, not a threshold.** `break` stays at 85 as a collapse
  backstop and is not raised. It cannot be the ratchet, and the reason is structural rather than numeric:
  **failing a global percentage takes more survivors than the largest file in scope even carries**, so no
  single file's tests can break it however bad they get. Deleting every assertion in one module leaves the
  gate green. The two counts that show this are dated to a scope and a commit, and they move whenever the
  scope does, so they live where they are measured — `scripts/gates/mutation-survivors.json` and the slice
  document — and deliberately not here. Instead every surviving mutant is listed, with its file, line,
  column, mutator, replacement,
  a kind and a measured reason, and **an unlisted survivor refuses the run**. That catches the first survivor
  at any denominator, forces each one to be told apart in writing, and survives a narrowed scope. The list
  moves **down** only (decision 5).
- **Speed: incremental mode is off, and the gate refuses it.** It was measured returning a stale score over
  rewritten tests, and this document exists because of gates that are green for an unrelated reason. The full
  run costs most of an hour and that cost is paid rather than escaped.
- **The gate checks the shape of its own run, and refuses a run whose shape says it learned nothing**,
  whatever it scores. Four clauses, each watched failing: a killed or surviving mutant with no completed
  test; **detections resting on a clock** above a quarter, counting not only the runner's own timeouts but
  kills whose recorded output is a test timing out, which is the same event reached by a different path;
  kills naming no failing test, counted and capped rather than refused outright, because a mutant that
  crashes the suite on import is a genuine detection; and a surviving mutant absent from the baseline. A
  **replay mode** runs every clause over a report already produced, so each one is watchable in seconds
  rather than in an hour, which is what makes `AGENTS.md` §7's "watched failing" affordable for a gate whose
  failing path a green pipeline never takes.
- **It does not replace the reviewer's mutation pass** (`AGENTS.md` §7). Stryker raises the floor
  mechanically; the reviewer still breaks a line by hand, predicts the failures per configuration first and
  compares. Where Stryker reports a **surviving mutant**, that is the reviewer's best candidate line, and the
  report is now part of what the reviewer reads.

## Decision 4 · The performance gate measures counters, not stopwatches

Wall-clock time on a shared CI runner is noisy enough to flap, and a gate that flaps is a gate people learn
to ignore. So the performance gate has two halves:

- **Deterministic counters, which are identical on any machine, and are the actual ratchet:** bytes retained
  per loaded commit, allocation counts on the hot path, number of live DOM row elements, number of canvas
  redraws for a scripted scroll, number of git processes spawned per refresh, timer wakeups while idle, and
  the **scaling ratio** between 10 000 and 40 000 commits, which catches an accidentally quadratic algorithm
  regardless of how fast the machine is.
- **Wall-clock budgets from ADR-0002 decision 6**, checked with a wide tolerance in CI so that only an
  order-of-magnitude regression fails, and checked strictly on the development machine by the executor and
  by the reviewer, where the numbers mean something.

Baselines live in `perf/baselines.json`, committed. The job compares and fails on regression. **Updating a
baseline is a visible commit** that the reviewer reads against the diff, so an improvement is recorded and a
regression cannot be hidden by editing the target.

## Decision 5 · The ratchet: checkpoints that cannot regress

Four committed baselines, all checked by gates, all only movable in the improving direction without an
explicit and explained commit:

| baseline | file | moves |
| --- | --- | --- |
| Coverage thresholds, per directory | test configuration | up only |
| Surviving mutants, each with its measured reason | `scripts/gates/mutation-survivors.json` | down only |
| Performance counters and budgets | `perf/baselines.json` | toward less time and less memory only |
| Distributable size budget | size configuration | down only |

Plus the behaviour itself: end-to-end runs and, once S07 has shown that a render is byte-stable on this
machine, golden images for the graph. Until that is demonstrated, the renderer's mechanical gate is the
layout model's unit tests plus end-to-end reads of the rendered state, exactly as ADR-0001 says.

## Decision 6 · One workflow, one line in Actions

**There is exactly one workflow file, `.github/workflows/ci.yml`.** This is the whole of the owner's
requirement, and it follows from how GitHub Actions renders:

- The Actions list and the pull request checks show **one row per workflow run**. Jobs are nested inside that
  row and expand. Two workflow files mean two rows for the same commit, which is the orphan case to avoid.
- Therefore every trigger lives in this one file — `pull_request`, `push` to `dev` and `main`,
  `workflow_dispatch`, and any future schedule — and jobs that should not run for a given event are skipped
  with a condition, never moved to a second file.
- A reusable workflow called with `uses:` still renders **inside** the calling run, so splitting for
  readability later stays compatible with the requirement. A second file with its own `on:` trigger does not.

The job graph, all inside that one run:

```
build ─┬─ static      (format, lint, boundaries, types, contract, licences, provenance, commits, placeholders)
       ├─ unit        (vitest + coverage thresholds)      ─── mutation   (stryker, incremental)
       ├─ e2e         (playwright, windows, built app)
       ├─ perf        (counters + budgets vs baselines)
       └─ size        (bundle and installer budget)
                                                           └─ gate       (needs all of the above)
```

- `build` installs once with a cached store, builds, and publishes the artifacts every other job consumes.
  Nothing installs twice.
- **`gate` is the single required status check.** It needs every other job, so branch protection has one
  entry and a pull request shows one line that is green or red, expandable into everything that produced it.
- `concurrency` cancels superseded runs for the same branch, so the Actions list stays one row per commit
  that matters.
- Failures upload what is needed to understand them: Playwright traces and screenshots, the Stryker HTML
  report, the coverage report, the performance comparison.
- The repository is public, so standard runners, including Windows, cost nothing.

**Branch protection is a repository setting.** Making `gate` a required check, and requiring it before a
merge into `main`, is a change to the hosted repository that only the owner may authorise
(`AGENTS.md` §2). The workflow works without it; the requirement is what makes it binding.

## Decision 7 · The shape of the pull request

`dev` integrates lanes locally, merged by the orchestrator with `--no-ff`; that does not change. A **pull
request exists only for a promotion**, `dev` into `main`, at the end of a milestone, and it is opened only
when the owner asks for the push. Its single required check is `gate`, its title is the promotion commit
subject, and the milestone's delivery record is its body. One milestone, one pull request, one line in
Actions, one tag.

Lane branches are never pushed and never get a pull request. That keeps `AGENTS.md` §2 intact and keeps the
Actions history readable as the project's actual delivery history, one row per milestone.

## Consequences

- The first milestone grows a slice: the gate pipeline and the workflow are built once, before the feature
  lanes, so every later lane inherits them. That is S02 in `docs/PLAN.md`, alone in its wave.
- All development dependencies are installed by the scaffold slice, S01, even those only S02 uses. Otherwise
  two lanes of the same wave would both touch `package.json` and the lockfile, which `AGENTS.md` §5 forbids.
- Mutation testing adds minutes to every run. Incremental mode and a narrow scope keep it tolerable; if it
  ever stops being tolerable, the answer is a narrower scope or a nightly full run inside the same workflow,
  never a second workflow file.
- Some gates will be unreliable before they are tuned, especially the performance one. A flapping gate is
  treated as a defect of the gate and fixed, never as a reason to relax a threshold.
- The first pull request this repository ever sees is the promotion of E01-M01.
