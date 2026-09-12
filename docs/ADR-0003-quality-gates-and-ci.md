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
| 7 | **Mutation** | `gates:mutation` | StrykerJS with the Vitest runner. See decision 3. |
| 8 | Build | `gates:build` | esbuild produces main, preload and renderer bundles. |
| 9 | End to end | `gates:e2e` | Playwright drives the built Electron application on fixture repositories. This is `AGENTS.md` §7's "open the actual thing", made repeatable. |
| 10 | **Performance** | `gates:perf` | Counters and budgets against committed baselines. See decision 4. |
| 11 | Size | `gates:size` | Bundle and installer size budget, so the distributable does not drift upward unnoticed. |
| 12 | Licences | `gates:licences` | Every dependency's licence is on an allow-list of permissive licences. The repository is public and MIT; a copyleft dependency arriving transitively is caught here, not by a stranger. |
| 13 | Provenance | `gates:provenance` | A weak, mechanical companion to `AGENTS.md` §1: no dependency, file name or committed string referring to the extension's package or publisher. It cannot prove a clean room. The reviewer's reading of the diff remains the real check. |
| 14 | Commits | `gates:commits` | Conventional Commits over the range, and **no AI attribution of any kind** (`AGENTS.md` §9), which is otherwise a rule only a human remembers. |
| 15 | Placeholders | `gates:placeholders` | No `TODO`, stub, skipped or focused test in the changed files (`AGENTS.md` §6.7). Runs over the working tree, not `git grep`, because `git grep` sees only tracked files (`AGENTS.md` §10). |

Gates 1 to 8 and 11 to 15 run on any platform. Gate 9 and 10 run on Windows, the verified platform
(ADR-0001).

## Decision 3 · Mutation testing with StrykerJS

**Tool: StrykerJS**, with `@stryker-mutator/vitest-runner`. It is the fastest to adopt for this stack: it
reads the existing Vitest configuration, needs one configuration file, and requires no change to a single
test. The owner named it, and nothing here argues against it.

- **Scope: `core/` and the pure parsers in `adapters/`.** These hold every decision that can be wrong, and
  they are pure, so their tests are fast enough for mutation to be affordable. The renderer and the
  composition root are excluded: mutating wiring produces mostly equivalent mutants and long runs, and their
  guarantee comes from the end-to-end gate instead.
- **Thresholds:** `break` at 85 for `core/`, 75 for the parsers, raised as a ratchet (decision 5), never
  lowered without a commit that says why. Stryker fails the build below `break`.
- **Speed:** incremental mode, with the incremental file cached in CI keyed by the lockfile and the source
  tree. A full run happens on `main` and on the promotion pull request; a pull request runs incrementally.
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
| Mutation `break` thresholds | Stryker configuration | up only |
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
