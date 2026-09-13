# AUDIT-<lane>

**Branch:** `<type>/e<ee>-m<mm>-<lane in lowercase>`

Task: TASK-<lane>.md
Parent: E<ee> > E<ee>-M<mm> > E<ee>-M<mm>-S<ss>   (for a fix: Repairs: <slices> — finding <id> in REVIEW-<nn>.md)
Base: <full hash>
Head: <full hash>
Status: COMPLETE | INCOMPLETE | BLOCKED

> This file is a **claim, not evidence**. The reviewer checks every line of it against the diff, and where
> they disagree the diff wins. Record findings, not listings: **no file contents and no diffs.**

## What was done

<One entry per scope item of the task, in the task's order, each with the short hash of the commit that
does it.>

## What was not done, and why

<Every scope item not delivered, every need raised instead of built, every decision left to the owner.>

## Gates

| gate | command | result | how it was proved to fail |
| --- | --- | --- | --- |
| <name> | `<exact command>` | pass / fail | <the probe planted, the red run seen, the probe removed, the green run seen — or "unproven" and why> |

Include every failure met on the way and how it was fixed.

**A gate that reports a score reports how it arrived at it.** Give the denominator and the breakdown, not
the headline: for the mutation gate, how many mutants were killed by a failing assertion and how many merely
timed out; for coverage, the number of files below the threshold, not the total.

**Report the survivor list's length beside the run's survivor count, as a pair.** They are usually equal and
the interesting thing is when they are not. The gate cannot refuse a listed mutant that a run reports as
killed, because that verdict has been measured drifting between runs over identical source, so the gap
between the two numbers is the only instrument that turns the drift into a series someone can read.

The reason is a defect this project met for real. Four consecutive lanes reported a mutation score of 100.00
while the share of mutants that only timed out went from ten per cent to ninety-nine point six. Each number
was true in isolation, none was wrong on its own terms, and the gate had stopped measuring the tests
entirely. **Nobody put the four side by side, because no audit was asked for the second number.** A trend
across audits is invisible unless every audit carries the same quantity.

## Boundary check

<The output of `git diff --name-only <Base>..HEAD` — a list of paths, not a diff — and a note for every path
that is not in the task's **May touch**.>

## Deviations from the task

<Every place the work differs from the task file, and every conflict between the task and `AGENTS.md`. "None"
only if there are none.>

## Clean room

<A statement that no Git Graph source, style or asset was opened or reproduced, from any version or fork or
from memory; and the source and licence of any third-party asset added.>

## What a green build would not catch

<Answered for this task specifically. For anything that renders: what was run and what was seen.>

## Open questions

<For the reviewer or the owner.>

## Rebase

<Only if the task has a `## Rebase` section: the `dev` commit rebased onto, and every conflict and how it was
resolved.>

## Sessions

<Only if more than one executor context worked this task: what each session did and where it stopped.>

## Background processes

<Every process spawned, and how each was verified stopped (port or command line).>
