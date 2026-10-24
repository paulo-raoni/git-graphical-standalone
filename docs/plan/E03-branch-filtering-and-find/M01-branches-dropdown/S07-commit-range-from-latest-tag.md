# E03-M01-S07 · The commit gate reads from the latest promotion's tag

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S07 commit range from the latest
tag

## What changed

`scripts/gates/commits.js` used to start its default range at `v0.0.0` whatever tags came after it, so once
`v0.1.0` existed the range still took in `f1e3db7` `chore(release): E01-M01 First graph`, whose subject
commitlint's `subject-case` refuses. Now, with no argument and no `GATE_COMMIT_RANGE`, the range starts at the
**previous promotion's tag**, the base `AGENTS.md` §7 says the reviewer reads from. The argument and the variable
mean what they meant: the argument first, then the variable, and an empty value of either falls through to the
default as before.

The gate now prints which range it read and why, for example
`commits: checking v0.1.0..HEAD, because v0.1.0 is the latest promotion tag behind HEAD`, or `because
GATE_COMMIT_RANGE names it`, or `checking HEAD, because no promotion tag is on an ancestor of HEAD`.

Nothing else moved: `commitlint.config.js`, the attribution patterns, the way the conventional half splits a
range into `--from` and `--to`, and `.github/workflows/ci.yml` are as they were.

## How the base is found

Three steps, each a git command whose meaning does not depend on tag names or dates:

1. `git for-each-ref --merged=HEAD --no-contains=HEAD --format='%(objecttype) %(refname:strip=2)' refs/tags`
   lists every tag whose commit `HEAD` reaches (`--merged`) and that does not itself reach `HEAD`
   (`--no-contains`). Among tags `HEAD` reaches, the only ones that also reach it are tags on `HEAD` itself, so
   this is every tag on a proper ancestor of `HEAD`. The gate keeps those whose object type is `tag`, which only an
   annotated tag has, and whose name matches `^v0\.\d+\.\d+$`, `AGENTS.md` §8's form.
2. `git rev-parse <tag>^{commit}` peels each to its commit.
3. `git merge-base --independent <commits>` prints the commits that no other of them is an ancestor of. When the
   tags lie on one line of history, which promotion tags do because every promotion is a merge onto `main`, that
   is exactly one commit, the latest by ancestry, and its tag is the base. If it prints more than one, no tag is
   the latest by ancestry, and the gate refuses with a finding naming them rather than guess, because a guess
   could start the range after commits it has to read. Two tags on the same commit name the same range, and the
   first in refname order is printed.

**The line the range hinges on** is the `merge-base --independent` call in `previousPromotion`: it is what
turns "the tags behind `HEAD`" into "the latest of them" by ancestry. The filter beside it,
`type === 'tag' && PROMOTION_TAG.test(name)`, decides which tags count at all.

### A tag on `HEAD` is skipped, and why

The task asked for the latest promotion tag that is an ancestor of `HEAD`; git counts `HEAD` as its own ancestor,
and this lane chose not to. On the commit a promotion tags, the gate reads from the promotion before it, so the
release merge that the §8 amendment of 2026-10-24 is about is itself checked. Counting a tag on `HEAD` would make
the range empty at that commit, and nothing would ever read the release merge: the next milestone's range
starts at it and `..` excludes it. It also follows from the code, and was not run both ways, that the range is
the same whether the tag has reached a clone before the commit or after it. The cost is measured below: at `f1e3db7`, the tip of `main` today, the gate
reads `v0.0.0..HEAD` and is red, because `f1e3db7` is that release merge. It was red there before this change
too, over the same range.

## What it reads where

Measured by this lane on 2026-10-24, by running the lane's `commits.js` in each state. The rows marked *clone*
ran in a throwaway clone of this repository made outside the worktree, where the probe tags and probe commits
were created and which was deleted afterwards; no tag or commit was created in this repository. In the clone,
`origin/main` and `origin/dev` are this repository's `main` (`f1e3db7`) and `dev` (`6cc54f9`), and the lane's
`commits.js` was written over the checked-out one for those two rows only (`tree.js` and `commitlint.config.js`
are the same at both).

| where | `HEAD` | range read | exit |
| --- | --- | --- | --- |
| this lane at `Base`, before the change | `6cc54f9` | `v0.0.0..HEAD` | 1, `f1e3db7`'s `subject-case` the one error |
| this lane at the change | `16f6ef1` | `v0.1.0..HEAD` | 0 |
| `dev`, clone | `6cc54f9` | `v0.1.0..HEAD` | 0 |
| `main`, clone | `f1e3db7`, tagged `v0.1.0` | `v0.0.0..HEAD` | 1, `f1e3db7` |
| annotated `v0.9.9` on `16f6ef1`, `HEAD` on it, clone | `16f6ef1` | `v0.1.0..HEAD` | 0 |
| the same tag, one commit added on top, clone | child of `16f6ef1` | `v0.9.9..HEAD` | 0 |
| a commit with subject `Planted Bad Subject.` added after that, clone | its child | `v0.9.9..HEAD` | 1, `subject-case` on it |
| that commit removed, clone | child of `16f6ef1` | `v0.9.9..HEAD` | 0 |
| annotated `v0.9.9` on a commit made from `v0.1.0` that is not an ancestor of `HEAD`, clone | child of `16f6ef1` | `v0.1.0..HEAD` | 0 |
| lightweight `v0.9.9` on `16f6ef1`, clone | child of `16f6ef1` | `v0.1.0..HEAD` | 0 |
| annotated `release-9` and `v1.0.0` on `16f6ef1`, clone | child of `16f6ef1` | `v0.1.0..HEAD` | 0 |
| annotated `v0.9.8` and `v0.9.9` on two children of `16f6ef1`, `HEAD` their merge, clone | the merge | refused: no tag is the latest by ancestry | 1 |
| a release merge `chore(release): e03-m01 branches dropdown` of the lane into `v0.1.0`, tagged `v0.2.0`, clone | the merge | `v0.1.0..HEAD` | 0 |
| the same with subject `E03-M01 Branches dropdown`, clone | the merge | `v0.1.0..HEAD` | 1, `subject-case` on it |
| one commit after that promotion, clone | its child | `v0.2.0..HEAD` | 0 |
| every tag deleted, clone | child of `16f6ef1` | `HEAD` | 1, `f1e3db7` |

A planted message is caught inside the default range here too, without moving `HEAD`: a commit object on no
branch, child of `16f6ef1`, with subject `fix(e03-m01-s07): Planted Bad Subject.`, read with
`GATE_COMMIT_RANGE=v0.1.0..<object>`, exits 1 on `subject-case` and `subject-full-stop`; one with a
`Co-Authored-By` trailer naming a model exits 1 on the attribution half.

## Continuous integration

*Inference from `.github/workflows/ci.yml`, not observed on a runner.* The `static` job checks out with
`fetch-depth: 0`, which fetches the whole history and every tag, and runs `npm run gates:commits` with no
argument and no `GATE_COMMIT_RANGE`, so it reads the default range.

- **A push to `dev`** reads from the latest promotion tag behind the pushed commit, as the `dev` row above did.
  Right after a promotion, when `dev` is fast-forwarded onto the tagged release merge, it reads the whole milestone
  just promoted, release merge included.
- **A push to `main`** is a promotion: its tip is the release merge and carries the new tag, which is skipped, so
  it reads from the previous promotion's tag and checks the milestone and its release merge, as the simulated
  promotion rows above did.
- **A pull request** is checked out at the merge commit GitHub makes of its head into its base, which carries no
  tag, so it reads from the latest promotion tag behind that commit: for the promotion pull request of `dev` into
  `main`, the milestone's commits and that merge commit. A subject of the form `Merge <a> into <b>` is among the
  messages commitlint skips by default: read from the default ignores of the installed `@commitlint/is-ignored`
  21.2.2, not run against such a commit here; that GitHub's merge commit has that subject is not checked either.
