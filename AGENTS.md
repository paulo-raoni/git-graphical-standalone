# AGENTS

This file is the workflow contract for **git graphical standalone**. It is authoritative. Everything in it
is a **rule**: where it says MUST or NEVER there is no judgement call to make. A rule that turns out to be
wrong is changed here, in a commit, with the reason. It is never bypassed in the moment.

**This contract wins on everything it states.** A task file is authoritative **only** for what this contract
delegates to it: reference behaviour, scope, boundary, dependencies, interfaces, gates, evidence, and a
`## Rebase` instruction. A task that requires breaking any rule of this file is a **defective task**. The
executor does not carry out that part: it stops and writes its audit with `Status: BLOCKED`, naming the rule
and the task line that conflicts, and the author of the task repairs the task.

---

## 1 · The clean-room rule

Git Graph (`mhutchie/vscode-git-graph`) is not under an open-source licence. From v1.5.0 onward its
`LICENSE` states: *"Permission is NOT GRANTED to publish, distribute, sublicense, and/or sell derivative works
of the Software."* This repository is public, so nothing in it may be a derivative work of Git Graph.

- **Behaviour is the only input.** It comes from running the extension and observing it, and from its
  user-facing documentation **as published on its Marketplace page**: the listing, its `README`, its
  `LICENSE`, its Changelog, its settings list and its command list. It is recorded in this repository in our
  own words. Its repository stays off-limits, including the `package.json` and the `CHANGELOG.md` inside it:
  the same text is read only where the Marketplace publishes it.
- **NEVER open, read, copy, adapt or translate** any other part of Git Graph: its source code, stylesheets,
  icons, images, localisation strings or any other file of its repository or of its packaged extension. This
  covers **every version**, including the MIT-licensed releases before v1.5.0, and **every fork**.
- **NEVER reproduce its code from memory.** An agent that recognises it is recalling that source stops and
  says so in its audit.
- **No screenshots or recordings of Git Graph are committed.** Observations are written down as behaviour.
- A third-party asset (an icon set, a font) is added only from its **original source under its own licence**,
  never from Git Graph's copy of it, and its source and licence are recorded in the commit body.

The reviewer checks every sequence against this section (§7).

---

## 2 · Roles

Three roles. **A context holds exactly one role for its whole life.**

| role | who | writes |
| --- | --- | --- |
| **ORCHESTRATOR** | the main session, working with the owner | plan and contract documents, slice task files; merges, promotions, tags |
| **EXECUTOR** | one fresh context per task file | product code, tests, build config, the slice document, its audit |
| **REVIEWER** | a context that wrote nothing in the sequence under review | fix task files, review files |

**Nobody approves what they wrote.** The reviewer and the executor are never the same context. The
orchestrator never reviews. An executor never reviews, not even its own work "as a check".

**The owner approves `docs/PLAN.md`, the architecture decision records under `docs/` that it rests on, and
the MVP cut, once.** Inside the MVP, epics
and milestones need no separate approval. Outside the MVP, the owner approves every EPIC and every MILESTONE
before its first task file is written.

### What each role MAY do. Everything not listed is forbidden.

**EXECUTOR**
- Read the repository, within §1.
- Edit files **inside its task's boundary, inside its own worktree**, and nowhere else.
- Build, run gates and tests, and start processes that it then stops.
- **Commit on its own lane branch**, which is the branch checked out in its worktree.
- Rebase its own lane branch onto `dev`, **only when its task file has a `## Rebase` section**.
- Replace commits of its own lane by commits with **identical trees** whose messages differ, **only when its
  task file has a section that allows it** and names the commits, and only before the lane is merged. The audit
  lists every replaced commit's old and new hash and tree. (Added 2026-10-17: review round 21 found that four
  task sections had allowed such rewrites, every one tree-identical, while this list did not, and three
  executors had committed a subject one character over §9's limit.)

It MUST NOT: switch branches; create, delete or rename branches or tags; merge; push; touch any remote or the
hosted repository's settings; open pull requests; add or remove worktrees; touch another worktree or the
primary checkout; edit or delete its task file; change dependencies its task does not name.

**REVIEWER**
- Read everything, including every worktree and every file of the sequence.
- Run gates and mutation probes **inside the review worktree** the orchestrator created for it, and revert
  every probe before finishing.
- Write `TASK-FIX-<nn>.md` and `REVIEW-<nn>.md` at the root of the primary checkout.

It MUST NOT: commit; edit product files anywhere except transiently inside its review worktree; edit task or
audit files; merge, push or tag; touch any remote or the hosted repository's settings.

**ORCHESTRATOR**
- Commit to `dev`, **only**: `EPIC.md` and `MILESTONE.md` files, the other documents under `docs/` that are
  not slice documents, `AGENTS.md`, `README.md`, the two templates, the workflow block of `.gitignore`, and
  lane merge commits.
- Commit to `main`, **only** promotion merge commits (§8).
- Create and remove worktrees and branches; merge; tag; copy sequence files between the primary checkout and
  worktrees.
- **Push, only when the owner explicitly asks for it in the current session.**
- **Create, rename, delete or reconfigure a remote, or change the hosted repository's visibility or settings,
  only when the owner explicitly asks for it in the current session.** Never otherwise.

It MUST NOT: write or edit product code, tests or build config, **including resolving a merge conflict in
them by hand** (§5); edit audit files; review; promote unless every item of §8 is true.

The only commit ever made to `main` outside §8 is the initial scaffold commit.
**This contract takes effect with the initial scaffold commit.** Before it, the scaffold is written, reviewed
and repaired in the primary checkout on the unborn `main`, with no branch or worktree, because none can exist
yet. Even then an executor never reviews its own work, and the reviewer is a different context. This exception
ends at that commit and never applies again.

---

## 3 · The planning hierarchy: EPIC > MILESTONE > SLICE

**Every work item has a parent.** A milestone belongs to one epic, a slice to one milestone, a slice task to
one slice, and a fix task to the milestone in flight (naming the slices it repairs). Nothing is built that
does not sit in this tree.

| level | ID | what it is |
| --- | --- | --- |
| EPIC | `E01` | a capability area, for example drawing the commit graph |
| MILESTONE | `E01-M02` | a shippable increment, and **the unit of promotion to `main`** |
| SLICE | `E01-M02-S03` | one task, one executor, one lane, one branch |

- Numbers are two digits, start at `01`, and are **never reused**. A dropped item keeps its number and is
  marked dropped, with the owner's approval noted.
- Slices are numbered **in dispatch order** when the milestone is planned. A slice added later takes the next
  free number.
- **Exactly one milestone is in flight at a time.** `dev` is promoted to `main` whole, so a second milestone
  on `dev` would ride into `main` unfinished.

### Where the documentation lives

```
docs/plan/
  E01-<slug>/
    EPIC.md              goal, scope, out of scope, milestone list           orchestrator, owner-approved
    M01-<slug>/
      MILESTONE.md       goal, slice table, gates, base tag, delivery record  orchestrator, owner-approved
      S01-<slug>.md      what was implemented and why, for a reader of the code   that slice's executor
```

- Slugs are lowercase ASCII kebab-case, at most 40 characters. The **same slug** is used in the folder or
  file, the task file and the branch.
- **A folder or file is created only when its item is planned.** No placeholders, no empty epics.
- The **slice table** in `MILESTONE.md` carries ID, title, wave and a one-line outcome, nothing more. Scope
  and boundary live **only** in the task file, because a second copy is a copy that diverges.
- The **slice document** describes the result, not the specification. It is written in the slice's own lane,
  inside its boundary.

---

## 4 · The sequence files

A **sequence** is every working file of the milestone in flight. They are the handoff between long sessions,
so **each task file is written for a context that has no memory of anything else.**

| file | written by | one per |
| --- | --- | --- |
| `TASK-S<ss>-<slug>.md` | orchestrator | slice |
| `AUDIT-S<ss>-<slug>.md` | the executor of that slice | slice task |
| `TASK-FIX-<nn>.md` | reviewer | defect to fix |
| `AUDIT-FIX-<nn>.md` | the executor of that fix | fix task |
| `REVIEW-<nn>.md` | reviewer | review round |

- The **lane** is the part between `TASK-` and `.md`, for example `S03-lane-colours` or `FIX-01`.
- `<ss>` is the slice number. `<nn>` for fixes **continues across review rounds** and never resets within a
  milestone: if round 1 produced `FIX-01` to `FIX-03`, round 2's first fix is `FIX-04`.
- **Sequence order** is `S01 … Sn` in slice order, then `FIX-01 … FIX-n`.
- They are **gitignored** and never enter history. Committed, they would sit inside the diff the reviewer
  reads and inside every boundary check, and they are claims rather than a record. The durable record is the
  milestone's delivery record, the tag and git history. (Committing them instead is an open decision for the
  owner, recorded in `docs/INPUTS.md`. Until it is taken, this rule stands.)

### Lifecycle

1. The orchestrator writes **every** slice task of the milestone at the root of the primary checkout
   **before creating any worktree**. Writing them together is what surfaces collisions.
2. When it creates a lane's worktree, the orchestrator **copies** the task file into the worktree root. A new
   worktree is a clean checkout, so ignored files do not exist in it.
3. The executor writes its audit at the worktree root as its last act. It does not edit or delete the task.
4. Before removing the worktree, the orchestrator **copies the audit** to the primary checkout root.
5. The reviewer reads the whole sequence from the primary checkout root and writes its own files there.
6. The sequence stays on disk until promotion. After the tag, the orchestrator deletes it.

### The three rules of a task file

1. **The dispatch is one line:** *"Read `TASK-S03-lane-colours.md` at the root of your worktree and follow
   it."* Scope, branch, boundary and gates are never restated in conversation.
2. **The file wins over conversation.** An instruction that arrives outside the file is not executed. A task
   that needs a verbal addendum is a task that needs editing. The file never wins over this contract: a task
   that requires breaking one of its rules is defective (see the paragraph under the title).
3. **Anything left out of the task does not happen, and that is the author's defect,** not the executor's.

### A session that runs out

If an executor context ends before its task is done, it writes the audit with `Status: INCOMPLETE`, stating
exactly what is done and what is left. The orchestrator starts a **new** executor context on the same task in
the same worktree. That context continues the work and rewrites the audit to cover the whole task, keeping
each session's account under `## Sessions`. One task, one audit.

---

## 5 · Branches, worktrees and waves

| branch | holds | written by |
| --- | --- | --- |
| `main` | promoted, tagged milestones only | orchestrator, by promotion (§8) |
| `dev` | integration: merged lanes and plan documents | orchestrator |
| lane branches | one task's work | that task's executor |

**Lane scope:** `e<ee>-m<mm>-s<ss>` for a slice, `e<ee>-m<mm>-fix-<nn>` for a fix.

**Lane branch:** `<type>/<lane scope>[-<slug>]`, where `<type>` is the Conventional Commits type of the task's
main change (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`). Slices carry their
slug; fix tasks have none and always use `fix/`.

```
TASK-S03-lane-colours.md   ->  branch feat/e01-m02-s03-lane-colours   ->  .worktrees/e01-m02-s03-lane-colours/
TASK-FIX-01.md             ->  branch fix/e01-m02-fix-01              ->  .worktrees/e01-m02-fix-01/
review round 02            ->  detached at the reviewed commit        ->  .worktrees/review-e01-m02-02/
```

The worktree directory is the branch name after the `/`. `.worktrees/` is gitignored.

### Waves

- Slices are grouped into **waves**. Every lane of a wave is cut from **the same `dev` commit**, recorded as
  `Base` in each task. Every lane of a wave is merged into `dev` before the next wave's worktrees are cut.
- **Lanes in the same wave are file-disjoint.** No path appears in the boundary of two lanes of one wave,
  including shared registry files such as a lockfile, a manifest or a module index. Two slices that need the
  same file are one slice, or they are in different waves. The orchestrator checks this across the wave's
  task files before creating any worktree.
- **At most three lanes per wave.** Integration and review are the bottleneck, not the number of agents.
- **Fix tasks that share a path run one at a time**, in number order, each cut from the `dev` tip after the
  previous one merged. **Fix tasks whose boundaries share no path may run together**, at most three, cut from the
  same `dev` commit like the lanes of a wave; the orchestrator checks the boundaries against each other before
  cutting them. (Owner's ruling, 2026-10-09: sequential fixes cost a full gate run each for lanes that could not
  collide.)
  A review file may state another order for the fix tasks still unmerged, with its reason; that order then
  holds. (Added 2026-10-09: review round 20's fixes each run every gate, and FIX-28 found a gate on `dev` that
  goes red inside the full run for a reason no queued task repairs, so the task that repairs it has to run
  before the ones numbered ahead of it.)

### Entering the tree

**The orchestrator decides where every change enters the tree, and leaves the tree organised and clean.**

- A lane enters `dev` by `git merge --no-ff <branch>` with the message `<type>(<lane scope>): <task title>`.
- **Never merge `dev` into a lane branch.** If a lane does not merge cleanly, the orchestrator aborts the
  merge and adds a `## Rebase` section to that task naming the new `dev` commit. An executor (the original
  context or a new one) rebases the lane inside its worktree and records it in the audit under `## Rebase`.
  The conflict resolution is then part of the diff the reviewer reads.
- After a merge: copy the audit out, remove the worktree, delete the branch. `dev` never carries a stray file.

### Worktree rules

- **NEVER remove a worktree with uncommitted changes.** Stop and say so.
- **NEVER delete a branch that is not merged into `dev`.**
- **NEVER run `git worktree prune`** from a machine or container other than the one the worktrees were
  created on.
- A task never asks an executor to read a gitignored file, because it will not exist in the worktree. Inline
  what the lane needs.

---

## 6 · What the executor does, every time

1. Read the task file at the root of your worktree. It is the single source of truth.
2. Check that `git branch --show-current` matches the task's `Branch` line and that
   `git merge-base --is-ancestor <Base> HEAD` succeeds. If either fails, stop and write the audit with
   `Status: BLOCKED`.
3. Implement **only** what the task describes. Anything that seems needed and is not in it is **raised in the
   audit, not built**.
4. Stay inside the boundary. If the task cannot be done inside it, do the part that can and raise the rest.
5. Run **every** gate the task names, and prove each one fails (§7). **A gate you did not run is a gate that
   failed.**
6. Commit on your lane branch, following §9.
7. **No placeholder passes as work.** A `TODO`, a stub, a skipped or focused test, an unimplemented branch,
   `todo!()` or `unimplemented!()` is reported as a blocker, never as completion.
8. Write the audit, following `AUDIT_TEMPLATE.md`. It carries findings, not listings: **no file contents and
   no diffs**. The reviewer reads those from disk.
9. Stop every process the task started, and **verify by port or by command line**, never by a shell's job
   table. Leave the worktree clean and everything committed. **Do not push.**

---

## 7 · Review and evidence

### When

At the **end of every wave**, once every lane of the wave has been merged into `dev`. Then again, in full,
after every fix task of a round has been merged. And once more over the **whole sequence** before promotion,
even when the last wave's review already passed.

### How

1. The orchestrator creates the review worktree, detached at the `dev` commit to be reviewed.
2. The reviewer reads **the diff**, `git diff <base tag>..<reviewed commit>`, where the base tag is the tag of
   the previous promotion. Then it takes every task and audit of the sequence and checks, item by item, that
   the diff implements every task's scope and stays inside every task's boundary.
3. **The audit is a claim, not evidence.** It tells the reviewer where to look. **Where the audit and the
   diff disagree, the diff wins**, and the disagreement is itself a finding.
4. It runs every gate listed in `MILESTONE.md` at the reviewed commit.
5. It runs the mutation pass below on every slice whose value is a guarantee.
6. It checks the diff against §1 and the commit messages against §9.
7. It writes `REVIEW-<nn>.md`: the reviewed commit, the base tag, a verdict per task, the gate matrix, the
   probes and their results, every finding, and **a verdict of `PASS` or `FAIL`**.
8. The orchestrator removes the review worktree once the review file exists.

### A FAIL

The reviewer writes one `TASK-FIX-<nn>.md` per independent defect, numbered in sequence, each naming the
slices it repairs and the finding it comes from. **Corrections to committed sentences are one task for the whole
round**, whatever number of findings and files they span, because each is minutes of work and a lane apiece is
hours of gates (owner's ruling, 2026-10-09). The orchestrator runs them one at a time (§5), and a **new**
executor context takes each one and writes its `AUDIT-FIX-<nn>.md`. When the last one is merged, the reviewer
**reviews everything again**: the whole diff from the base tag, every task and every audit. It then writes the
next `REVIEW-<nn>.md`.

### A PASS

Every finding is classed by the reviewer, in the review file, with the reason:

- **Blocking:** a defect of the product (what a user of the application would meet), a breach of §1, §9 or §10,
  or a defect of a gate that protects the product: a gate that stays green when the thing it guards is broken,
  or that goes red on an unchanged product.
- **Carried:** everything else — a sentence that measurement contradicts, test-infrastructure hygiene, a
  measurement worth taking, an improvement.

`PASS` means **zero open blocking findings**. Carried findings do not hold a promotion: the reviewer lists them
in the review file, the orchestrator adds each to `docs/PLAN.md` as an item of the next milestone before
promoting, and the next milestone's first wave takes them. The class is the reviewer's judgement and is argued,
not assumed; when in doubt a finding blocks. (Owner's ruling, 2026-10-09: six review rounds followed the fifth
wave of the first milestone, each with new findings, and review rounds 17 to 20 named no defect of the
application among theirs.) Beyond that the reviewer never defers a finding on its own. A `PASS` review file is
the reviewer's **handover to the orchestrator**, and nothing else is.

### A gate is not evidence until it has been watched failing

A check that would stay green with the code deleted proves nothing, and from outside it looks exactly like
one that works. For every gate an executor adds or relies on: **plant a probe** that should make it fail,
**watch it go red**, **remove the probe**, **watch it go green**, and record all four steps in the audit. A
gate that has never been seen red is reported as unproven.

### A claim carries its measurement

The first milestone's second wave found the same defect four times, in four artefacts, by four authors, two
of them the reviewer and two the orchestrator: **a sentence asserting how this project behaves, written
without measuring it.** Each sounded true, each was wrong, each cost a review round, and not one would have
survived a minute of its own author's attention.

**Every committed sentence stating how this project behaves must say what was measured and how, or name who
measured it.** This binds task files, audits, review files, slice documents and the documents under `docs/`
exactly as §7 binds gates.

- **A number carries its method and its range.** "The worst case" is a claim about every case. "The worst
  size found by an exhaustive pass over every append to 200 000 commits" is a claim a search establishes.
  Where the two differ, write the second.
- **A fact you could falsify in a minute, falsify before you write it**, not after someone else commits it.
- **Repeating another's measurement makes it yours.** Reproduce it, or say whose it is and that you did not.
- **An inference is labelled as one.** "It could not have launched" is not an observation, and reads as one.
- **A message a gate prints is a committed sentence too.** A guard whose failure text repeats a discredited
  claim teaches the next author the error at the moment they are deciding.

The reviewer checks prose against this section the way it checks gates against the rest of §7.

### The mutation gate, and the reviewer's own mutation

A mutation-testing gate runs over the rings that hold the product's decisions, with a score threshold that
fails the build (`docs/ADR-0003-quality-gates-and-ci.md`). It is mechanical, it runs on every slice, and it
raises the floor: a test suite that asserts nothing cannot pass it.

**It does not replace the pass below.** The gate proves the suite kills the mutants a tool can generate; the
reviewer proves the suite exercises *this slice's guarantee*, which is a judgement no tool makes. The two
compose: **every mutant the gate reports as surviving is a candidate line for the reviewer**, and the
reviewer says in its review file whether it used one and why it chose the line it chose.

### The reviewer mutates a different line

Breaking the same line the executor already broke only re-confirms a claim that was never in doubt.

1. **Predict in writing first** which checks must fail and which must stay green, per configuration and not
   just as a total, because a total hides a configuration that detects nothing.
2. Neuter **one line that the executor's audit did not name as its probe**. Run. Compare with the prediction.
3. Too few failures means the checks do not exercise the slice. Too many means they are coupled to something
   else. **Both are findings.**
4. Revert, and prove it with `git status --short` printing nothing in the review worktree.

### Open the actual thing

A description of an artefact is not the artefact. Anything that renders is **run and looked at**, not
inferred from green gates. Reference behaviour is **observed in the real extension**, not taken from memory
or from someone's account of it.

---

## 8 · A complete delivery, and promotion to `main`

**The unit of delivery is one whole MILESTONE.** A looser unit such as "some slices" cannot be applied the
same way twice. Nothing else ever enters `main`: a defect in a promoted milestone is repaired by a later
milestone.

### Checklist: every item true, each checked by command, in this order

1. `MILESTONE.md` is on `dev`, and every slice in its table is either merged or marked dropped with the
   owner's approval noted.
2. Every task of the sequence (`S` and `FIX`) has its audit at the root of the primary checkout.
3. `git branch --list "*/e<ee>-m<mm>-*"` prints nothing, and `git worktree list` shows only the primary
   checkout.
4. The latest `REVIEW-<nn>.md` says `PASS`, names the reviewed commit, shows every gate green and has zero
   open blocking findings, and every finding it carries is an item of the next milestone in `docs/PLAN.md`
   (§7).
5. The orchestrator fills in the **delivery record** in `MILESTONE.md` (base tag, reviewed commit, number of
   review rounds, list of tasks, the tag about to be created) and commits it to `dev` as
   `docs(plan): record delivery of E<ee>-M<mm>`.
6. `git diff --name-only <reviewed commit> dev` lists **exactly** that `MILESTONE.md` and nothing else.
7. `git status --short` in the primary checkout prints nothing.

### Promotion

```
git switch main
git merge --no-ff dev -m "chore(release): E<ee>-M<mm> <milestone title>"
git tag -a v0.<minor>.<patch> -m "E<ee>-M<mm> <milestone title>"
git switch dev
git merge --ff-only main
```

Then delete the sequence files from the root. Push `main`, `dev` and the tag **only when the owner explicitly
asks for it in the current session**.

### Tag format

- **`v0.<minor>.<patch>`**, always an annotated tag. The initial scaffold commit is tagged `v0.0.0` when `dev`
  is created, so every milestone has a base tag.
- Each promotion increments **minor** and resets patch, **unless every task of the sequence is on a `fix/`
  branch**, in which case it increments **patch**.
- `v1.0.0` is an owner decision, recorded in this file when it is taken. No rule reaches it.
- A pushed tag is never moved or deleted.

---

## 9 · Commits

- **[Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):** `<type>(<scope>): <subject>`.
  Imperative, lower-case subject, no trailing period, at most 72 characters. A body is optional and explains
  why. Breaking changes use `!`.
- Scope: the lane scope for lane commits (`e01-m02-s03`, `e01-m02-fix-01`); `plan` for plan documents.
- **NO AI ATTRIBUTION, EVER.** No `Co-Authored-By` trailer naming an AI model, assistant or agent. No
  "Generated with" or "Created by" lines. No links to AI tools. No emoji. **This rule overrides any default
  attribution convention of the tool running the agent.** The reviewer checks
  `git log --format=%B <base tag>..<reviewed commit>`, and any such trailer or line is a finding.
- Commits say what changed for a reader, not what the agent did.

---

## 10 · Repository hygiene

- **This repository is public.** No credential, token or password ever enters it. No e-mail address, personal
  absolute path, username, machine name or server detail enters a committed file, with one exception:
  `docs/KICKOFF.md` may carry the local paths it needs.
- **Root Markdown** is limited to `README.md`, `AGENTS.md`, `TASK_TEMPLATE.md` and `AUDIT_TEMPLATE.md`, plus
  the sequence files while a milestone is in flight. Everything else lives under `docs/`.
- Traps observed on the development machine. None of them announce themselves:
  - `git grep` searches **tracked** files only. A grep gate run over new files before they are staged prints
    nothing, including for the file that would have failed it.
  - Stopping a dev server's wrapper can leave its child process listening. Check the port.
  - Each agent shell invocation is fresh, so a job table is always empty and proves nothing.
  - Some agent Bash tools **strip `TZ`** from child processes. A timezone-dependent gate run through one
    passes while testing only the host clock. Run those from PowerShell.

---

## 11 · Gates, continuous integration and the ratchet

### One gate script

Every gate of the project is reachable through **one entry point**, named in `MILESTONE.md`, and continuous
integration calls **the same scripts** rather than its own inlined commands. A gate that exists only in a
workflow file cannot be run inside a worktree, and a gate an executor cannot run is a gate that fails at the
wrong moment, against work already merged.

### Gate tiers: a lane runs the gates its change can move

Every lane used to run every gate, and the mutation gate alone took 88 minutes in E01-M01-FIX-28's last run;
most fix lanes after the fifth wave of the first milestone changed no file it reads. **The task file names the
lane's tier, and the tier is a boundary** like the mutation scope: an executor may not narrow it to pass or widen
it to look thorough. (Owner's ruling, 2026-10-09.)

| tier | script | for a lane whose boundary holds |
| --- | --- | --- |
| static | `npm run gates:static` | only Markdown documents |
| quick | `npm run gates:quick` | anything else that the mutation run does not read |
| full | `npm run gates` | a file the mutation run reads: anything under the mutated folders, a unit test, or the mutation and unit configuration |

**The wall-clock budgets are their own gate, `npm run gates:budgets`**, and are in none of the tiers: every
case and every benchmark reading whose verdict is a time, a processor share or a settled memory reading. A lane
runs it only when its boundary holds code that ships or the budget cases themselves, and then on a free
machine, under the rule below. Run seconds after this project's own mutation gate, one of those cases went red
on an unchanged product (E01-M01-FIX-28, 2026-10-04).

**The reviewer runs everything**, `npm run gates` and then `npm run gates:budgets` on a free machine, at the
reviewed commit, every round. That is what bounds the exposure of a narrower tier to one round.

These scripts are landed by E01-M01-S11; until it is merged, `npm run gates` is the only entry point and holds
every gate.

### Where evidence comes from

**Executors never push (§2), so continuous integration never sees a lane branch.** The primary evidence for
a slice is produced locally, in its worktree, and recorded in its audit with the probe that proved each gate
can fail (§7). Continuous integration is the **ratchet on `dev` and `main`**: it runs when the orchestrator
pushes, which happens only when the owner asks, and on the promotion pull request. A green pipeline is never
accepted in place of an audit, and a red one is a finding regardless of what any audit claims.

### One workflow, one line

There is **exactly one workflow file**. Every trigger lives in it, and a job that should not run for a given
event is skipped by condition, never moved to a second file. The reason is how the platform renders: one row
per workflow run, with jobs nested inside it, so a second file is a second row for the same commit and an
orphan. One job depends on all the others and is the single required check.

### Pull requests

Lane branches are never pushed and never get a pull request. **A pull request exists only for a promotion**,
`dev` into `main` at the end of a milestone (§8), opened only when the owner asks for the push. One
milestone, one pull request, one tag.

### The ratchet

A committed baseline — coverage thresholds, mutation thresholds, performance counters and budgets, size
budgets — **moves in the improving direction only**. Loosening one is a commit that says why, inside the
diff the reviewer reads. An executor that cannot meet a baseline raises it as a blocker in its audit; it
never edits the target to match its result. A gate that flaps is a defect of the gate, fixed as one, and
never a reason to relax a threshold.

### Wall-clock gates on a shared machine

The development machine is shared with other projects' agents, and a mutation run of another project can hold
every core for minutes. Measured by E01-M01-FIX-27 on 2026-10-03: under its first two methods, every start and
load run that met such a stretch went red on an unchanged product; under its final method the same cases were
green in ten of ten full runs at 10 to 100 % sampled load. **The owner ruled on 2026-10-03 that the machine when
free decides.**

- The strict limits stand. Nothing is widened for load.
- **Free is a measured state, not an empty process table.** (Amended 2026-10-10: E01-M01-S11 waited 144 minutes
  for a table with no other project's run in it and never got 65 seconds of one, because an idle run of another
  project stayed listed for hours.) The machine is free for a reading when the processor load, sampled every
  five seconds or oftener across all processors, averaged under 40 % over the minute before it and over the
  reading itself, with no sample over 75 % during it. **The load counted is that of everything except the
  reading's own process tree**: counted whole, a reading can discard itself, as E01-M01-S11 measured on
  2026-10-10 when the gate's own cold-start cases sampled 45.7 to 77.7 % with no other run listed. The two
  numbers are the orchestrator's first choice and are to be re-argued by whoever measures that they are wrong.
- A wall-clock reading taken when the machine was not free by that measure is **discarded, whatever it read**:
  it is recorded as discarded, with its load, and the case is read again when the machine is free.
- A red on a free machine is red. A case that goes red on a free machine is a defect of the product or of the
  gate, and never a reason to re-run until green.
- The record (audit or review file) carries every reading, kept or discarded, the load sampled during each, and
  what else was running.
