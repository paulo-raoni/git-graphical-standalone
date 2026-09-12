# E01-M01-S08 · The contract decode API

Where the two halves of the commit store live, and the one question that decides which half a new function
belongs to.

## What exists now

Nothing a user sees has changed. The window still opens and says `No repository is open.`, which was
confirmed by building and running `npm start` in this lane and reading the window, not inferred from a green
build.

What moved is a boundary. `src/core/store/` was one folder holding two different kinds of function, and they
are now in two rings:

| half | where it lives | what it is |
| --- | --- | --- |
| **building** a page | `src/core/store/` | `createCommitStoreBuilder`, `appendCommit`, `buildCommitColumns`, `retainedByteLength`, `storeWork`, and the hash index, pending-parent table and growth helpers behind them |
| **decoding** a page | `src/contracts/` | `commitCount`, `hexHashOf`, `subjectOf`, `parentsOf`, `authorOf`, `committerOf` and the `Person` they return |

No function's body, signature or behaviour changed. The unit suite that covers the decoders was not edited
except for its import path and an explanatory header: the 104 assertions of `npm run gates:unit` pass here and
passed at the base commit, and none of their expected values moved. Those two test files stayed in
`src/core/store/` in this lane and **came home in FIX-06**, which added the boundary rule that let them; the
section at the end of this document says where they are now.

## The test that decides the ring

> **A function that could have been written another way belongs to `core/`. A function that only reads back
> what the contract already fixed belongs to `contracts/`.**

Ask of the function: *could a reasonable person implement this differently and still be right?*

- **Yes — it is policy, and it is `core/`.** Interning people by name and address rather than by a joined key
  is a choice. Growing a column by five quarters rather than by two is a choice, and the wrong one costs the
  96-byte budget of `docs/ADR-0002-architecture-and-performance.md` decision 6. Open addressing over a
  `Uint32Array` rather than a `Map` of hex strings is a choice. Each of these can be *wrong*, which is what
  makes it a decision, which is what puts it where the mutation gate and the performance gate watch it.
- **No — it is the encoding read back, and it is `contracts/`.** `hexHashOf` cannot return anything but the
  twenty bytes at `row * HASH_BYTE_LENGTH` spelled as forty hex characters. `subjectOf` cannot return
  anything but `subjects.slice(subjectOffsets[row], subjectOffsets[row + 1])`. There is no second
  implementation to compare it against: changing what one of them returns would be changing what
  `CommitColumns` *means*, and a change to what a contract means is a change to the contract.

The corollary is the useful half. `CommitColumns` is a **compressed** encoding — binary object names, two
offset tables, one string blob, an interned people table — so **a consumer holding one cannot read a single
field of it without these functions**. A data contract its consumers cannot read is not a complete contract;
it is a contract plus a missing library. That is the whole argument, and it is recorded in
`docs/ADR-0002-architecture-and-performance.md` decision 3, amended 2026-09-12.

## Why it had to move, rather than being a tidier place for it

`src/ui/` may import `src/contracts/` and nothing else. That is not a convention: it is the
`ui-only-contracts` rule of `.dependency-cruiser.cjs`, an error rather than a warning, and `gates:boundaries`
is the whole of it.

With the decoders in `core/`, the renderer could not read one field of the page it exists to draw. The two
ways round it were both worse than moving four files:

- **Widen the renderer's rule.** The rule is what surfaced the problem. A boundary that is relaxed the first
  time it is inconvenient is a boundary that will be relaxed again, and the next time the thing on the far
  side of it will be a layout decision rather than a hex conversion.
- **Send the renderer a per-row view model.** The renderer and the store live in different processes
  (`docs/ADR-0002-architecture-and-performance.md` decision 2), so a per-row view model is an inter-process
  round trip per scroll frame against the 8 ms frame budget of decision 6. Bulk data crosses as transferable
  buffers precisely so that it does not have to be re-materialised on arrival; a decoder that cannot travel
  with the buffers throws that away.

The decoders were simply in the wrong ring, and `ui → contracts only` is the rule that said so.

**This was proved, not assumed.** In this lane `src/ui/renderer.ts` was made to import `commitCount`,
`hexHashOf` and `subjectOf` from `src/contracts/index` and to write their results into the empty state, so
the bundler could not elide them. `gates:boundaries`, `gates:types` and `gates:lint` all passed, and the
built `dist/renderer.js` contained the decoders' own error text, which is how the retention was checked
rather than assumed. The import was then **removed**: S05 is the slice that draws a commit, and until then an
import kept only to demonstrate something is a placeholder (`AGENTS.md` §6.7). `src/ui/` is byte-identical to
its state at the base commit.

## What this means for the next lane

1. **Decoding a `CommitColumns` is imported from `src/contracts/`.** S04 may; S05 must.
2. **Building one is imported from `src/core/store/`.** S03 does.
3. `src/core/store/index.ts` does **not** re-export the decoders, and does not forward them from
   `src/contracts/` either. A forwarding barrel would leave every old import working, which would mean the
   rings had been separated in the file tree and nowhere else. The type checker is what enforces this:
   importing any of the seven moved symbols from `src/core/store/index` is `TS2305`, "has no exported
   member".

### `column-read.ts` came too, and is not part of the contract's surface

`entryAt` is the one indexed read of a typed array that `noUncheckedIndexedAccess` obliges, and the decoders
use it on every call. `src/contracts/` may import nothing outside itself, so a decoder left naming a helper
in `core/` would fail `contracts-depends-on-nothing`. It therefore moved as well, and `hash-index.ts` and
`pending-parents.ts` — which are builder code and stay in `core/` — now import it from
`src/contracts/column-read`, which `core-only-inward` permits.

It is deliberately **not** re-exported from `src/contracts/index.ts`. The exported surface of that barrel is
snapshotted by `gates:contract`, and `entryAt` is a shared helper rather than a term of the vocabulary. A
module inside `contracts/` is not automatically part of the contract; what `index.ts` exports is.

### What this lane could not finish, and where FIX-06 put it

Moving the sources moved them out from under two gates and out of reach of their own tests, and all three of
the files that would have fixed that — `stryker.config.json`, `vitest.config.js` and
`.dependency-cruiser.cjs` — were outside this lane's boundary, because `AGENTS.md` §5 keeps a wave's shared
registries out of its lanes. So this lane raised them and **FIX-06 closed them**. Both records are kept: the
asymmetry below is the reason the boundary rule now has the shape it has.

- **The decoders left the mutation gate's scope, and had no coverage floor.** `stryker.config.json` mutated
  `src/core/**` only, so the six decoders and `entryAt` — held to that gate in S02 — were mutated by nothing,
  and `vitest.config.js` thresholded `src/core/**` only, so the 100 per cent the two files read was recorded
  and not enforced. Their unit tests ran and failed when a decoder was broken (measured in
  `AUDIT-S08-contract-decode-api.md`), and that was the whole of the floor. FIX-06 added
  `src/contracts/**/*.ts` to `mutate` and a `src/contracts/**` coverage threshold at 100 per cent of
  statements, branches, functions and lines.
- **The two test files could not follow the code, and now have.** `contracts-depends-on-nothing` forbade the
  ring every import, with no carve-out for a colocated test, so a `*.test.ts` under `src/contracts/` failed
  `gates:boundaries` for naming `vitest` — measured in this lane, two errors, one per file. `core-only-inward`
  had exactly such a carve-out, paired with `core-tests-only-inward-and-the-runner`, because `core/` had tests
  from S02 onward; `contracts/` never needed one until it acquired these functions. FIX-06 mirrored that pair:
  `contracts-depends-on-nothing` now carries `pathNot: TEST_FILES` and **`contracts-tests-only-the-runner`**
  permits a colocated test `^src/contracts/` and `^node_modules/vitest/` and nothing else. So
  `column-read.test.ts` and `commit-columns.test.ts` live in `src/contracts/`, beside the modules they test,
  and no longer import across a ring boundary. The rule's `to` clause is the whole of the guarantee, and it
  was probed both ways in that lane: a contracts test naming another ring, another package or a Node builtin
  fails it, and a **non-test** file under `src/contracts/` naming `vitest` still fails
  `contracts-depends-on-nothing`.
