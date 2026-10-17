# Inputs

This repository did not start from nothing. This file records what it inherited, what it changed or rejected
and why, and what is still open, so that a later disagreement is with something specific.

## Sources

- **braidline**: a private scaffold of the same product idea, created on 2026-08-25. It holds a README, a
  workflow contract, a task template, a build plan and setup notes, and no code. Nothing in it was a closed
  decision.
- **atelier**: a private repository whose workflow contract braidline's was derived from.

Neither source is reproduced here beyond what this repository actually adopts.

## Adopted, rewritten in this repository's terms

| idea | from | now in |
| --- | --- | --- |
| Reviewer and executor are never the same context; nobody approves what they wrote | both | `AGENTS.md` §2 |
| The task file is the single source of truth: one-line dispatch, the file wins, omissions are the author's defect | both | §4 |
| The audit is a claim, not evidence; the reviewer reads the diff, and the diff wins | both | §7 |
| One worktree and one branch per lane; file-disjoint lanes within a wave; waves as barriers; at most three lanes | both | §5 |
| Worktree safety: never remove one with uncommitted changes, never delete an unmerged branch, never prune from elsewhere, never point a task at an ignored file | both | §5 |
| A gate is not evidence until it has been watched failing | both | §7 |
| The reviewer mutates a different line than the executor, predicting per configuration first | both | §7 |
| Open the actual thing rather than a description of it | both | §7 |
| Conventional commits with no AI attribution; no placeholder passes as work; processes verified stopped by port | both | §6, §9 |
| A machine-readable `Branch` line carrying exactly one backticked token | both | the templates |
| Environment traps: `git grep` sees tracked files only, orphaned server children, empty job tables, Bash tools stripping `TZ` | both | §10 |
| Setup facts: WebView2 already present, Rust not installed, shared `CARGO_TARGET_DIR` across worktrees | braidline | `docs/SETUP.md` |

## Changed, and why

| inherited | here | why |
| --- | --- | --- |
| Two roles, with the reviewer also authoring tasks and landing work | Three roles: orchestrator, executor, reviewer | The owner requires the reviewer to hand over to a main orchestrator. Separating landing from reviewing keeps "nobody approves what they wrote" true when the planner also writes the tasks. |
| Review of each slice as it lands | Review of the **whole sequence** after all slices are merged, in rounds, with numbered fix tasks | Owner's requirement. It also catches integration defects that no single slice shows. |
| The executor deletes its task; the reviewer deletes the audit as a receipt | Both kept until promotion, then deleted by the orchestrator | The reviewer needs the whole sequence, and re-reads all of it every round. The receipt is now the `PASS` review plus the delivery record. |
| Free-form `TASK-<name>.md` | `TASK-S<ss>-<slug>.md`, `TASK-FIX-<nn>.md`, `REVIEW-<nn>.md` | Sequence order and the parent in the hierarchy must be readable from the name. |
| One trunk, no integration branch (braidline) | `dev` and `main`, promotion per milestone, with a tag | Owner's requirement. braidline's argument was that nobody consumes an integration point. That does not hold for a public repository, where `main` is what outsiders clone. |
| Tags "at milestone boundaries", format unspecified | `v0.<minor>.<patch>`, a mechanical bump rule, `v0.0.0` on the scaffold | A tag rule that needs judgement will not be applied the same way twice. |
| Milestones only | EPIC > MILESTONE > SLICE, with IDs and a documentation layout | Owner's requirement: every work item has a parent. |
| Subject-only commits | Subject required, body optional | The body is where a third-party asset's source and licence are recorded (§1). |
| Root Markdown limited to three files | Four, adding `AUDIT_TEMPLATE.md` | The audit shape is now a contract the reviewer checks against, so it is a file rather than a paragraph. |

## Rejected, and why

- **"A viewer, not a client"** (braidline's scope limit). This project's goal is to reproduce Git Graph's
  behaviour, and Git Graph acts on the repository from the graph as well as displaying it. Scope is set per
  epic instead.
- **The build plan's stack presented as "decided".** Demoted to an input. See "Open" below.
- **The one-working-day schedule and its day budget.** No schedule is adopted.
- **One pull request per integrated wave to limit CI billing** (atelier). There is no CI. See "Open".
- **Git Graph's MIT-licensed early releases as a source.** Using them may be legally possible, but it would
  make the provenance of every later file arguable and turn the clean-room check into a judgement call.
  `AGENTS.md` §1 excludes every version.
- **Everything specific to atelier's client work.** Not relevant here and not carried.

## Open, for the owner

1. **The stack.** braidline's plan proposed Tauri 2, a Rust core, `git log` read over a pipe instead of
   libgit2, Canvas 2D rendering instead of SVG or DOM nodes, and TypeScript without a framework. That is an
   input with reasons attached, not a decision. `docs/SETUP.md` records what each candidate costs to set up
   on the development machine.
2. **Commit the sequence files, or keep them ignored.** The default is ignored (§4). Committing them would
   give a public audit trail, at the price of noise in history and of files that sit inside the diffs being
   reviewed.
3. **The first EPIC, MILESTONE and SLICE breakdown for drawing the graph.** Inputs from braidline's plan:
   generate fixture repositories deterministically from a script instead of committing them; freeze the data
   contract between lane assignment and rendering before running lanes in parallel; keep lane assignment
   sequential with a single owner; and use golden images as the mechanical review gate, after first
   confirming that a render is byte-stable across runs.
4. **Target platforms.** Windows only, or cross-platform from the start.
5. **Which Git Graph release is the behavioural reference.** The latest stable release is 1.30.0.
6. **The name.** Git's trademark policy permits the form "[Product Name] for Git" and forbids uses likely to
   cause confusion about provenance. "git graphical standalone" is not in the permitted form. Whether that
   matters is a judgement for the owner, and not a legal opinion recorded here.
7. **CI**, and if it is added, the pull-request shape.
8. **The complete-delivery unit and the tag format** are decided in `AGENTS.md` §8. The owner may overrule
   them, and the change is then made there.

## Taken since

The list above records what was open when this repository was scaffolded. These have since been decided, in
documents of their own. The entries stay above, unedited, so the reasoning can be read against what was
known at the time.

| open item | taken in | outcome |
| --- | --- | --- |
| 1 · The stack | `ADR-0001-stack.md` | The git CLI over a pipe and TypeScript without a framework are confirmed; Canvas 2D is narrowed to the graph column; Tauri and the Rust core are replaced by Electron. The footprint question the owner then raised is answered in its Axis 6. |
| 3 · The first breakdown for drawing the graph | `PLAN.md` §2 and its slice table | E01-M01 in seven slices across five waves. braidline's advice is carried: fixtures generated by script, the data contract frozen before any parallel lane, lane assignment kept in one sequential owner, golden images only after byte-stability is demonstrated. |
| 7 · CI, and the pull-request shape | `ADR-0003-quality-gates-and-ci.md` | One workflow file, one line per run, one required check. A pull request exists only for a promotion; lane branches are never pushed. |

Two documents were added that no open item asked for, because the owner raised the requirement after the
plan was first shown: `ADR-0002-architecture-and-performance.md`, which fixes the rings, the data
representation and the CPU and memory budgets, and the mutation-testing and regression-ratchet parts of
`ADR-0003`.

Items 2, 4, 5, 6 and 8 remain as written above. The live ones, with their defaults, are listed in `PLAN.md`
§7.
