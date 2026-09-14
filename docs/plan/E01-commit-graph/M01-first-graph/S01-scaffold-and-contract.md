# E01-M01-S01 · Scaffold, rings and the frozen contract

What a reader of the code needs to know about how this repository is laid out, why it is laid out that way,
and which parts of it later work is not free to change.

## What exists now

A single private npm package at the root, no runtime dependency, five gates reachable through
`npm run gates`, and an application that opens one window showing its name and the line
`No repository is open.` Nothing reads a repository, nothing draws a graph and no menu action does anything;
those arrive in S03 to S06.

## The rings

`docs/ADR-0002-architecture-and-performance.md` decision 1 fixes four rings and one rule: **dependencies
point inward only**. Under `src/`:

| directory | holds | may import |
| --- | --- | --- |
| `contracts/` | the shared vocabulary: data types and the IPC contract | nothing at all |
| `core/` | the domain and the use cases; pure, no I/O, no timers, no randomness | `contracts/`, `ports/` |
| `ports/` | the interfaces `core/` needs from the world | `contracts/` |
| `adapters/` | implementations of the ports | `contracts/`, `ports/`, `core/` |
| `app/` | the composition root: the Electron main process | anything inward |
| `preload/` | the bridge between the shell and the renderer | `contracts/` |
| `ui/` | the renderer | `contracts/` only |

Only `contracts/`, `app/`, `preload/` and `ui/` exist as directories today. `core/`, `ports/` and
`adapters/` are named in the rules and in the TypeScript projects but hold no file yet, because a directory
whose only content is a placeholder is a placeholder. S03 and S04 create them by putting real code in them.

Unit tests are **colocated** with the file they test, as `<name>.test.ts`. End-to-end tests live in
`test/e2e/`, which S02 creates. Colocation is what lets a later lane own a folder including its tests
without touching another lane's files.

### The rule is enforced twice, because the two halves catch different mistakes

**`dependency-cruiser`** (`.dependency-cruiser.cjs`, the `gates:boundaries` script) forbids each edge by
name, so a failure says which rule was broken rather than that something is wrong. Every rule is an error,
not a warning. Besides the ring edges it forbids any cycle, any orphan module — the three build entry points
excepted, since by definition nothing imports them — and any import that does not resolve, because an
unresolvable edge silently exempts itself from every other rule.

**The TypeScript projects** decide what each ring can even see, which is the half that actually keeps the
DOM and Node out of `core/`:

| project | library | types | covers |
| --- | --- | --- | --- |
| `tsconfig.inner.json` | `ES2023` | none | `contracts/`, `core/`, `ports/` |
| `tsconfig.ui.json` | `ES2023`, `DOM`, `DOM.Iterable` | none | `ui/` |
| `tsconfig.node.json` | `ES2023` | `node` | `app/`, `adapters/`, `preload/` |

`tsconfig.base.json` holds the flags all three share: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules` and
`verbatimModuleSyntax`, plus `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
`noPropertyAccessFromIndexSignature` and `erasableSyntaxOnly`. `tsconfig.json` at the root is a
solution file: it names the three so an editor opens all of them, and it is not itself a gate.

`gates:types` runs the three separately. Running them together would defeat the point: a single program
that has both `DOM` and `node` in it cannot tell you that `contracts/` reached for `document`.

## The frozen contracts

`src/contracts/` is the one thing three lanes of wave 3 share, so it is frozen before any of them starts.
Everything in it is plain `readonly` data. **Nothing in it is a class**, because all of it crosses a process
boundary and a class does not survive a structured clone with its prototype. There is no validator, builder
or factory: nothing constructs these types yet, and a helper written before its first caller is a helper
shaped by a guess.

| file | holds |
| --- | --- |
| `indices.ts` | `UNKNOWN_INDEX`, the sentinel for "not loaded" |
| `people.ts` | `PersonTable`, authors and committers interned once per page |
| `commits.ts` | `CommitColumns`, the columnar commit store, and `HASH_BYTE_LENGTH` |
| `refs.ts` | `Refs`, with `RefKind` and `RefFlag` |
| `working-tree.ts` | `WorkingTree` |
| `layout.ts` | `LayoutRows`, with `RowFlag` |
| `graph-page.ts` | `GraphPage`, the unit that crosses the boundary |
| `result.ts` | `Result`, `Success`, `Failure` and `FailureKind` |
| `ipc.ts` | `CHANNELS` and the request and reply types |
| `bridge.ts` | `GitGraphicalBridge` and the renderer's global declaration |
| `index.ts` | the single import surface for the other rings |

Four properties are load-bearing, and each is a decision rather than a style:

**The store is columnar.** A JavaScript object per commit costs 300 to 500 bytes once the engine has added
its header and shape, and every one of them is traced on each major collection. `CommitColumns` is a struct
of typed arrays: hashes stay binary and 20 bytes wide, parents are a compressed sparse row
(`parentOffsets` plus `parentIndices`, never a nested array), authors and committers are indices into an
interned `PersonTable`, timestamps are epoch seconds with the offset stored beside them and no `Date`
objects, and every subject lives in one string blob addressed by `subjectOffsets`. `Refs` and `LayoutRows`
follow the same shape for the same reason.

**An absent index is `UNKNOWN_INDEX`, not `null` or `-1`.** Every index lives in a `Uint32Array`, so
"absent" has to be a value inside the type's range. `0xFFFFFFFF` is the largest `Uint32` and cannot collide
with a real row.

**Kinds and flags are named constants.** `RefKind`, `RefFlag`, `RowFlag` and `FailureKind` are each a frozen
object plus a type of the same name, so no bare number or bare string appears at a call site, and the plan,
the code and the tests say the same words.

**Failures are values, not thrown errors.** Every reply is a `Result`: either `{ ok: true, value }` or a
`Failure` with a `kind`, a `message` and an optional `exitCode`. The discriminant means a consumer that
forgets the failure branch does not type-check. The `message` is **git's own message** wherever git produced
one and is never replaced by a friendlier sentence, because the user has to be able to read what git
actually said in order to act on it; a friendlier sentence may be shown as well, chosen from the `kind`.

`LayoutRows` deserves its own note, because it is the seam between two lanes of wave 3. A **segment** is one
line crossing the vertical band of a single row; a line passing straight through an untouched lane is a
segment whose two lanes are equal. That is the whole drawing instruction set — no curves, no multi-row
edges, no scene graph — so painting a viewport is a walk over a slice of these arrays and nothing else.
Colours are palette **indices**, never colour values, so a theme change repaints without recomputing the
layout.

**Two bits of `RowFlag` say where a row's own line begins and ends**, because a segment cannot. A segment
spans a whole band, so a branch tip's departing line and a root's arriving line are both spelled `(V, V)` in
the vertex's lane and a painter holding one cannot tell which half of the band it covers:

- `RowFlag.ClipAboveVertex` — paint nothing in the half band above the dot, in the vertex's own lane. Set
  when **no loaded row above names this commit as a parent**. Git emits children before parents, so a commit
  whose children are all absent from the rows loaded so far can never acquire one from a later page, and the
  bit is final on any page rather than provisional.
- `RowFlag.ClipBelowVertex` — paint nothing in the half band below the dot, same lane. Set when the commit
  has **no parent entry at all**, `parentOffsets[row + 1] === parentOffsets[row]`.

`ClipBelowVertex` reads the parent **count** and never a parent value, and that is the whole of what
separates a root from a page that ran out of commits: a parent entry of `UNKNOWN_INDEX` is a parent that
exists and is not loaded, so its line continues into the page below and the row is **not** clipped. The two
pages are otherwise byte-identical in every column of `LayoutRows`, which is why the distinction has to be a
bit in the contract rather than a convention a renderer could rediscover. Both bits are properties of the
**row**, which carries exactly one vertex, and neither says anything about lines crossing the row in other
lanes: those span the whole band as they always did. The painter is **required** to clip on them, because
`core/` cannot draw and the renderer answers no question of its own:
`docs/ADR-0002-architecture-and-performance.md` decision 1 says `ui/` holds no rule and that a question like
"which lane is this commit in" is never answered in the renderer, and decision 5 has the graph canvas redrawn
from the layout buffers. Where to stop a line is such a question, so the answer is a bit and not a heuristic.

Commit bodies are deliberately not in `CommitColumns`. The first milestone shows subjects only, and adding
bodies is a visible change to this contract rather than a quiet addition.

## The IPC contract and the bridge

`CHANNELS` is a frozen object and the only place a channel name is spelled; no string literal channel name
appears anywhere else. Five channels: open a repository by path, choose a folder, load more commits,
refresh, and application information.

The bridge the preload exposes is a **fixed set of five methods**, one per channel, and deliberately not a
generic `invoke(channel, payload)`. A generic one would let anything running in the page reach a channel the
renderer was never meant to use, which is the whole reason a bridge exists at all. The function that does
the sending is module-private and is never exposed. Adding a capability is therefore a change to
`contracts/bridge.ts` and to `preload/bridge.ts`, and is visible in review.

`contracts/bridge.ts` also declares the renderer's global, so `window.gitGraphical` is typed wherever the
renderer can see it.

## The window, and the line the guarantee hangs on

`src/app/window.ts` creates one `BrowserWindow` with `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`, no Node integration in workers or subframes, and `webviewTag: false`. The remote
module no longer exists in this Electron, so there is nothing to disable. Navigation and window opening are
refused, and an external link is handed to the user's browser instead.

**That `webPreferences` block is the one thing in this slice that silently degrades.** A window configured
wrongly compiles, builds and opens exactly like a correct one; the only thing that tells them apart is
asking the running renderer whether `window.require` exists. So it is checked by hand and the values are
recorded, not inferred from a green build. The renderer also asserts at startup that the bridge is present,
which turns a silent misconfiguration into an error in the console of the very window that has it.

Background throttling is **left on**. A hidden window that keeps running is what makes a desktop application
expensive on a laptop (`docs/ADR-0002-architecture-and-performance.md` decision 5).

The document carries a content security policy allowing only the application's own resources, with no inline
script and no network of any kind. It has no `frame-ancestors`: a policy delivered in a `meta` element may
not carry that directive, and Chromium logs it as ignored on every load. Framing is refused in the main
process instead, where it holds.

## The build

`scripts/build.js` produces three bundles into `dist/`:

| bundle | format | why |
| --- | --- | --- |
| `main.cjs` | CommonJS, Node target, `electron` external | The shell's entry point. |
| `preload.cjs` | CommonJS, Node target, `electron` external | A **sandboxed preload script cannot be an ES module**: Electron loads it through its own module system. |
| `renderer.js` | immediately invoked function, Chromium target | A `type="module"` script is fetched under cross-origin rules that a document loaded from the file system cannot satisfy, so a module build would simply not run. |

`index.html` and `renderer.css` are copied beside them. Source maps are on by default and off under
`--production`, which is what `npm start` and a later packaging step respectively want. The targets name
what this Electron actually bundles; downlevelling further would only hide a syntax error behind a transform
the shell never needed. When esbuild fails, the script lets esbuild's own diagnostic stand and sets a
failing exit status rather than burying the line under its own stack trace.

### What the bundles cost, and what `gates:size` is a budget of

Measured 2026-09-13, by splitting each bundle on esbuild's own module markers. Two numbers per bundle: the
development build, which is what `gates:size` weighed when these were taken, and the same bundle built with
`--production`, which is what it weighs now. *What `gates:size` became*, below, records the change and is
where the current budgets are derived.

| bundle | development | production | what the difference is |
| --- | --- | --- | --- |
| `main.cjs` | 2173 | 1078 | comments and whitespace; `main.cjs` reaches no contract module |
| `preload.cjs` | 1402 | 547 | comments and whitespace |
| `renderer.js` | 1215 | 649 | comments and whitespace |

Before 2026-09-13 the second and third were 5221 and 5849. **8469 of those bytes were contract constants
the bundles never read** — 3835 of `preload.cjs`, being `layout.ts`, `refs.ts` and `result.ts`, and 4634 of
`renderer.js`, those three and `ipc.ts` as well, since the renderer names no channel. `RowFlag`, `RefKind`,
`RefFlag` and `FailureKind` appear in neither entry point. Both import `src/contracts/index.ts`, and
`Object.freeze({ ... })` is a call expression esbuild cannot prove free of side effects, so every frozen
constant reachable through the barrel was retained whether or not anything read it. Comments are the other
half of the old numbers and not this half: the **production** build at the same commit carried every one of
those constants too, so minifying never dropped them.

The fix is `/* @__PURE__ */` in front of each of those calls, which is a claim esbuild acts on and which is
true here: `Object.freeze` returns the object it was given, cannot throw on an ordinary one, and its effect
is observable only through that object — so dropping the call when the object itself is dropped changes
nothing that can be seen. The annotation does not stop the freeze where the constant *is* used: `CHANNELS`
is still frozen in `dist/preload.cjs`, because the preload reads it.

The alternative fix was for the two consumers to import `../contracts/bridge` and `../contracts/ipc`
instead of the barrel. Measured on its own it gives 1386 and 1215 — sixteen bytes better than the
annotation, because the annotation's own text survives into the one constant the preload reads — and
measured *with* the annotation it gives exactly the annotation's numbers, so the two are not complementary.

**The annotation was taken alone, and the reason is about S05 rather than about bytes.** It sits on the
definition, not on the consumer, so it needs nothing remembered: a consumer that imports the whole barrel
and uses three of the five constants gets those three, still frozen, and the other two are dropped — which
is what a throwaway bundle over this ring was built to check. The import rule would have had to be
remembered by every consumer written after it, and nothing in the gate set can express it.

**The consequence that decided the question: while `gates:size` measured the development build, a doc
comment in a module a bundle reads spent that bundle's budget.** That is most of the 1.9× to 2.6× between
the two columns above, and it was 5.7× for `preload.cjs` before the dead constants left. `src/contracts/` is
where this project puts its most load-bearing prose — `RowFlag`'s two clip-bit doc blocks are 1748 bytes of
source on their own, the largest single piece of documentation in the project, and they were the bulk of
the 2251 bytes `layout.ts` cost the renderer while the renderer was pulling it in — so the gate as it then
stood priced documentation of the contract against the renderer's size budget.

That is also why the margin set that morning was what it was, and the reasoning is kept because a reader who
cannot see what changed cannot check the change. The two bounds were measured and they overlapped: the
smallest thing the budget should catch is one frozen constant returning, and the smallest of the four is
`FailureKind` at 471 bytes of the renderer; the largest ordinary edit it should absorb is a doc block, and
the largest of those is the 1748 bytes above. No margin satisfies both, so it was set towards the doc
block — a gate that fired on good prose would be the worse error in a project whose contract is mostly
prose — and what it still caught was the whole ring returning, which is the 4634 bytes it was set after.

### What `gates:size` became

The question the paragraph above left open — which build a size budget is a budget of — was decided the same
day in `docs/ADR-0003-quality-gates-and-ci.md` §2, gate 11, and E01-M01-FIX-12 implemented it. **The gate
weighs the production build and has gained a second instrument beside the byte count.** Every number below
was measured in that lane, on this machine, at the pinned esbuild 0.28.2.

The old reasoning was that unminified is the stricter measurement and needs no second build. Both halves
were true and neither survived what "stricter" turned out to mean. A stand-in renderer built outside the
repository, reading only the existing decode API and the flag constants — no row pool, no canvas, no
markup — costs **7232 development bytes and 1745 production bytes**, so under the development weighing
E01-M01-S05 was over a 3072-byte budget before a line of rendering existed, entirely from prose. Nothing
ships the development build; the budget now weighs the one that does.

What that gives up is the only instrument that saw the regression above. Weighed in production, the whole
unread contract ring returning to both shell bundles is +76 bytes, and a production budget passes it. So the
byte count no longer sees a module arrive, and `scripts/gates/module-manifest.json` does: a committed list of
which source modules contribute code to each bundle, refused on addition, taken from esbuild's `metafile`
rather than from the `// src/…` comment markers, because the production bundles carry **no markers at all**
and a marker is emitted per contiguous run rather than per module. Watched, with the `/* @__PURE__ */`
annotations removed: the byte count passed at 919 and 1228 against budgets of 2048 and 12288, and the
manifest refused, naming `layout.ts`, `refs.ts` and `result.ts` in `preload.cjs` and those three plus
`ipc.ts` in `renderer.js`.

The production build goes to `reports/size/production/`, which the gate makes itself and empties on every
run. It is not `dist/`: `gates:build`, `gates:e2e` and `npm start` keep the development build, verified by
hashing all eight files of `dist/` either side of a gate run and finding them unchanged. `reports/` is
already ignored by git, Prettier, ESLint and `scripts/gates/tree.js`, so the new directory needed no entry
added to any of their lists.

**The five budgets, re-based on production measurements.** `main.cjs` 3072, `preload.cjs` 2048,
`index.html` 2048 and `renderer.css` 3072 are each the measured size plus a kibibyte, rounded up — the
measurements being 1078, 547, 898 and 1313. `renderer.js` is **12288 and is an initial budget**, on the
precedent of `docs/ADR-0002-architecture-and-performance.md` decision 6, which sets ten budgets over an
application that does not exist and calibrates them at E01-M01-S07 by measuring the assembled one. This
budget is calibrated there too, so the movement expected of it is **downward at calibration**, not upward at
S05; it is not exempt from the ratchet. It is derived rather than defaulted: the floor is the 1745
production bytes above, of which 1320 are contract modules; the rate is **19.9 production bytes per line of
code**, the densest of nine modules built one at a time (the range is 4.9 to 19.9, and 19.9 is
`src/ui/renderer.ts` itself); and the one inference, labelled as one, is that a renderer meeting ADR-0002
decision 5 is about 500 lines of code. 500 × 19.9 + 1320 = 11270, and the next whole kibibyte is 12288. The
total is 20480, which leaves `renderer.js`'s allocation whole and still binds the other four: any two of
them may spend their full margin at once and any three may not.

**One correction to the record.** The measurement that set this lane going reported esbuild's
`metafile.outputs[…].bytes` and the file's size on disk as different numbers — 1365 against 1402 for the
development `preload.cjs` — and attributed the gap to the source-map comment a development build appends.
At esbuild 0.28.2 they are **equal**: all three bundles, both modes, `metafile.bytes` exactly the size on
disk, source-map comment included. The comment is indeed 37 bytes, which is the gap, so the two numbers
differ by whether that comment is counted — but the one `metafile` reports counts it. The budgets compare
the file on disk regardless, because that is what a distributable is.

## The scripts, which CI will call

`docs/ADR-0003-quality-gates-and-ci.md` §2 names them, and CI calls these and never its own inlined
commands, so the two cannot drift.

| script | runs |
| --- | --- |
| `gates` | the five below, in order, cheapest first |
| `gates:format` | `prettier --check .` |
| `gates:lint` | `eslint .` |
| `gates:boundaries` | `depcruise src` against the ring rules |
| `gates:types` | the three TypeScript projects, separately |
| `gates:build` | the three bundles |
| `build`, `start` | build, and build then run |

`gates` is a flat list, so S02 extends it by adding entries rather than by restructuring it.

## Lint and format

ESLint runs `typescript-eslint`'s **strict type-checked** preset over `src/`, plus: no default exports, no
explicit `any`, a complexity limit of 10, a module limit of 300 lines and a function limit of 50 —
`docs/ADR-0002-architecture-and-performance.md` decision 7 made mechanical. Build and configuration
JavaScript is linted without type information, because it belongs to no TypeScript project.

**Prettier and ESLint do not overlap.** No formatting rule is enabled anywhere in the ESLint configuration —
`typescript-eslint` moved its formatting rules out of these presets — so the two tools have nothing to
disagree about and no `eslint-config-prettier` is needed to separate them.

Prettier does not format Markdown. Every Markdown file here is prose written to a deliberate line width, and
the plan, the contract and the decision records belong to the orchestrator (`AGENTS.md` §2); reflowing their
tables would put an executor's formatting choice inside documents it may not edit, and would make every
later prose change a formatting argument.

## Dependencies

There is **no runtime dependency**. Every dependency is a development dependency, every one is pinned to an
exact version (`save-exact=true` in `.npmrc`), and the lockfile is committed. The whole milestone's
toolchain is installed here, including the parts only S02 uses, because two lanes of one wave may not both
touch the manifest or the lockfile (`AGENTS.md` §5).

**TypeScript is pinned to 6.0.3, not to the current 7.0.2.** TypeScript 7 is the native port of the
compiler; `typescript-eslint` 8.70.0 — the current stable line, and the only one — declares
`typescript >=4.8.4 <6.1.0`. Pinning 7 would mean the type-aware lint gate either refuses to run or runs
outside its supported range, and that gate is where `docs/ADR-0002-architecture-and-performance.md`
decision 7 actually lives. 6.0.3 is the newest stable release the lint toolchain supports. This is a pin to
revisit when `typescript-eslint` supports TypeScript 7, and moving it is a one-line change here plus a gate
run.
