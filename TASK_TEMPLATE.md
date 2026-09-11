# TASK-<lane> — <one line: what this task delivers>

**Branch:** `<type>/e<ee>-m<mm>-<lane in lowercase>`

Worktree: .worktrees/e<ee>-m<mm>-<lane in lowercase>/
Base: <full hash of the dev commit this lane is cut from>
Parent: E<ee> <epic title> > E<ee>-M<mm> <milestone title> > E<ee>-M<mm>-S<ss> <slice title>
Wave: <n> of <total>

> The `Branch` line carries **exactly one** backticked token and nothing else in backticks. Keep the other
> header lines free of backticks.
>
> **For a fix task** the file is `TASK-FIX-<nn>.md`, the branch is `fix/e<ee>-m<mm>-fix-<nn>`, `Wave` is
> omitted (fixes run one at a time), and `Parent` names the milestone, the slice or slices being repaired,
> and the finding: `Repairs: E<ee>-M<mm>-S<ss> — finding <id> in REVIEW-<nn>.md`.

Read this file and follow it. It is the single source of truth for this task. If a fact is not in this file,
it is not part of the task. **`AGENTS.md` wins on everything it states**: this file is authoritative only for
what `AGENTS.md` delegates to a task. If this file requires breaking any rule of `AGENTS.md`, do not carry out
that part: stop and write your audit with `Status: BLOCKED`, naming the rule and the line of this file that
conflicts.

## Why this task exists

<Two or three sentences: what is missing, and what changes for someone using the application once it lands.
For a fix: the defect, and how it was observed.>

## Read before writing anything

<The files already on `dev` that this task depends on, by path. Name them; do not paraphrase them.>

**Clean room (`AGENTS.md` §1):** do not open Git Graph's source, styles or assets, in any version or fork, and
do not reproduce its code from memory. The reference behaviour for this task is described below, in our own
words.

## Reference behaviour

<What the real extension does that this task reproduces, as observed. Precise enough to test against.>

## Scope

<What to build, in enough detail that nothing is left to guess. Where a decision belongs to the executor, say
so and require it to be argued in the audit.>

### Not in scope

<The adjacent things that belong to another lane or a later milestone, named.>

## Boundary

**May touch:** <exact paths, including the slice document
`docs/plan/E<ee>-<slug>/M<mm>-<slug>/S<ss>-<slug>.md`. No path here may appear in another lane of the same
wave.>

**May not touch:** <everything else; name the tempting files.>

**Dependencies:** <the exact dependencies this task may add or change, or "none".>

## Interfaces

<What this task exposes to other lanes, or consumes from work already on `dev`, with its exact shape.>

## Gates

<Every command that must pass, with its exact invocation. For each gate the executor adds or relies on, the
audit records the probe that made it fail (AGENTS.md §7).>

Always:

- The boundary check: `git diff --name-only <Base>..HEAD` lists only paths from **May touch**.
- The commit check: `git log --format=%B <Base>..HEAD` has no AI attribution and every subject is a
  Conventional Commit (AGENTS.md §9).
- The placeholder check: no `TODO`, stub, skipped or focused test, or unimplemented branch in the changed
  files.
- `git status --short` prints nothing.

## Evidence

<What would a green build NOT catch here? Name the line the task's guarantee hinges on. For anything that
renders, require the executor to run it and look.>

## Final step

1. Write `AUDIT-<lane>.md` at the root of your worktree, following `AUDIT_TEMPLATE.md`. No file contents and
   no diffs in it.
2. **Do not edit or delete this task file.** The reviewer reads it.
3. Kill every process this task spawned, and verify by port or by command line.
4. Worktree clean, everything committed on your lane branch. **Do not push, merge or open a pull request.**
