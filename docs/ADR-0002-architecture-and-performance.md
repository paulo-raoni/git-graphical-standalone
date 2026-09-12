# ADR-0002 · Architecture, and the performance budgets

**Status:** proposed, awaiting the owner's approval together with `docs/PLAN.md` and
`docs/ADR-0001-stack.md` (`AGENTS.md` §2).

**Date:** 2026-09-11

**Supersedes nothing. Depends on:** ADR-0001 (the stack).

## Context

The owner set two properties above feature count: **CPU efficiency** and **memory allocation**. The
application must be as light as possible while still exposing the whole repository. He also asked for
separation of concerns, clean architecture and clean code as working rules rather than aspirations.

Those two asks are the same ask. A design where the layers are confused is a design where nobody can say
which allocation belongs to whom, and an optimisation in one place is undone in another. So this ADR fixes
the layers, the dependency direction, the data representation and the numbers, and `docs/ADR-0003` turns
each of them into a gate. **A property that is not measured by a gate is not a property of this
application**, it is a hope.

The hard number that shapes everything: a user who keeps pressing "Load More Commits" on a large repository
reaches **tens of thousands of rows**, and the Linux kernel repository, the usual worst case, has well over a
million commits. Nothing in the design may cost per loaded row what it can cost per visible row.

## Decision 1 · Layers, and the dependency rule

Four rings. **Dependencies point inward only.** The inner rings know nothing of the outer ones: no import,
no type, no global.

```
contracts/   the shared vocabulary: data types and the IPC contract. Depends on nothing.
core/        domain and use cases. Pure TypeScript. No I/O, no Electron, no DOM, no timers, no randomness.
ports/       the interfaces core needs from the world: GitPort, ClockPort, ConfigPort, LoggerPort.
adapters/    implementations of the ports: the git CLI adapter, the file system, the settings store.
app/         the composition root (Electron main + utility process): builds adapters, injects them, wires IPC.
ui/          the renderer: virtualised table, graph painter, dialogs. Talks only through the preload bridge.
```

- **`core/` is the whole product's value** and holds every decision that can be wrong: parsing git's output
  into the commit store, assigning lanes, deciding what is visible, filtering, searching. It is pure, so it
  is fast to test, and it is where the mutation score has to be high (ADR-0003).
- **`ui/` holds no rule.** It renders a view model that `core/` produced, and emits intents. A question like
  "which lane is this commit in" is never answered in the renderer.
- **`adapters/` hold no rule either.** The git adapter spawns a process and hands bytes to a core parser. It
  does not interpret them.
- **`app/` is the only place that knows both sides**, and it contains no logic beyond wiring.

**Enforcement is mechanical, not cultural.** `dependency-cruiser` encodes the rule set and runs as a gate
(`gates:boundaries` in ADR-0003). `core/` importing `electron`, `node:fs`, `node:child_process` or anything
from `ui/` fails the build. A convention that is only written down is a convention that erodes in the third
lane; this one cannot.

**Why this matters for the way we work:** lanes of a wave must be file-disjoint (`AGENTS.md` §5). Rings
give a natural, stable seam. The git adapter, the layout core and the renderer are three lanes that cannot
collide, because the only thing they share is `contracts/`, which is frozen before any of them starts.

## Decision 2 · Processes, and where work happens

| process | owns | why |
| --- | --- | --- |
| **main** | windows, menus, lifecycle, settings | Must never block; it is what makes the window feel alive. |
| **utility** (`utilityProcess`) | spawning git, streaming and parsing its output, building the commit store | Parsing a large log is the one genuinely heavy CPU task. Off the main process, it cannot freeze the window, and the process can be torn down to return its memory to the operating system. |
| **renderer** | the view: virtualised rows, the graph canvas, input | Sandboxed, `contextIsolation` on, no Node integration. Receives a view model, never a git result. |

- The renderer and the utility process never talk directly. Everything crosses **one typed IPC contract** in
  `contracts/`, exposed to the renderer by a preload bridge with an explicit allow-list of channels.
- Bulk data crosses as **transferable `ArrayBuffer`s**, never as arrays of objects. Sending fifty thousand
  plain objects costs a structured clone, fifty thousand allocations and a garbage collection on arrival;
  sending three typed arrays costs a memcpy.
- The layout pass runs where the store lives (the utility process) and ships the resulting rows as buffers.

## Decision 3 · The commit store is columnar

A JavaScript object per commit, with string fields, costs roughly 300 to 500 bytes once V8 has added its
headers, shapes and pointers. Fifty thousand of those are 20 MB of objects the garbage collector must trace
on every major collection, which is felt as a stutter while scrolling. The store is therefore **struct of
arrays, not array of structs**:

- Hashes: one `Uint8Array` of 20 bytes per commit, binary, not 40-character hex strings. Hex is produced on
  demand, only for the few rows on screen.
- Parents: a compressed sparse row layout — one flat `Uint32Array` of parent indices plus a `Uint32Array` of
  offsets. No nested arrays.
- Author and committer: `Uint32Array` of identifiers into an **interned table**. A repository with fifty
  thousand commits typically has tens of authors; storing each name once is the difference between kilobytes
  and megabytes.
- Timestamps: `Float64Array` or `Int32Array` of epoch seconds, with the offset stored separately. No `Date`
  objects.
- Messages: **one contiguous string blob** with a `Uint32Array` of offsets. Subjects are sliced on demand for
  visible rows only.
- Layout output: `Uint16Array` for the lane, `Uint8Array` for flags, plus a compact edge list.

The store is a `core/` data structure with a small API, which makes it fully unit-testable and a first-class
target for mutation testing. **Every buffer grows geometrically and is reused on "Load More"**; the prefix
is never recomputed and never reallocated per page.

## Decision 4 · Everything is streamed and incremental

- The git adapter reads standard output as a stream and the parser consumes it **incrementally**, with a
  carry buffer across chunk boundaries. Git's whole output is never held as one string. Records use the
  ASCII record and unit separators, so no escaping and no regular expressions are needed on the hot path.
- Lane assignment is a **single forward pass** over the commits git returned, keeping only the set of open
  lanes. Appending a page starts from the state the previous page ended in. Nothing is quadratic in the row
  count, and nothing recomputes the prefix.
- Filtering and searching walk the columnar arrays and produce an index list. They never materialise
  objects.

## Decision 5 · Rendering costs the viewport, never the repository

- **Row recycling:** a fixed pool of row elements, sized to the viewport plus an overscan margin, is moved
  with a `transform` and rewritten in place. The number of live DOM elements does not depend on how many
  commits are loaded. Rows are never created and destroyed while scrolling.
- **One canvas** the size of the viewport for the graph column, redrawn from the layout buffers. Redraws are
  coalesced into a single `requestAnimationFrame`, and happen only on scroll, resize, theme change or new
  data. It is scaled by `devicePixelRatio`, and hit-testing is arithmetic, not a scene graph.
- **No layout thrashing:** each frame reads the DOM, then writes, never alternating.
- **Nothing animates by timer.** No polling loop, no interval that runs while the window is idle. An idle
  window uses no measurable CPU, which is the property users actually notice on a laptop.
- The file watcher that drives auto-refresh (E01-M03) is debounced and stops while the window is hidden.

## Decision 6 · The budgets

These are the initial budgets. **S07 of the first milestone calibrates them by measuring the assembled
application on the development machine and commits the baselines.** After that, a budget may be loosened
only by a commit that says why, which the reviewer reads (`AGENTS.md` §7). An executor that cannot meet one
raises it as a blocker; it does not quietly relax it.

| budget | limit | measured by |
| --- | --- | --- |
| Cold start to a painted window, empty repository | ≤ 1500 ms | end-to-end run |
| Load 10 000 commits, to rows painted | ≤ 800 ms | end-to-end run |
| Parse throughput, streamed log | ≥ 20 000 commits / s | benchmark |
| Lane layout throughput | ≥ 200 000 commits / s | benchmark |
| Structural memory per loaded commit, message text excluded | ≤ 96 bytes | benchmark over the store |
| Resident memory, all processes, 50 000 commits loaded | ≤ 400 MB | end-to-end run |
| Resident memory growth over 5 minutes idle after a load | ≤ 2 % | end-to-end run |
| Main-thread work per frame while scrolling | ≤ 8 ms, no frame over 16.7 ms | end-to-end run |
| Live DOM row elements | ≤ viewport rows + 2 × overscan, independent of commits loaded | end-to-end run |
| CPU while idle, window visible, no input | ≈ 0 %, no timer wakeups | end-to-end run |

The three that drive the design are **96 bytes per commit**, which forces the columnar store, **8 ms per
frame**, which forces row recycling and coalesced redraws, and **no timer wakeups when idle**, which forbids
polling.

## Decision 7 · Clean code, as rules a machine can check

Taste is not reviewable across contexts, so only the checkable part is a rule. `AGENTS.md` §7 already
forbids placeholders; these are added as gates in ADR-0003:

- Strict TypeScript. No `any` that is not explicitly justified at its line, no non-null assertion, no
  unchecked index access, no implicit `undefined` return.
- No default exports; one exported concept per module; modules under about 300 lines and functions under
  about 50, enforced by lint with the complexity limit rather than by opinion.
- Every port is an interface in `ports/`, and `core/` receives it by parameter. No singleton, no module-level
  mutable state, no service locator. Determinism in `core/` means time and randomness are injected.
- Errors are values on the boundaries that can fail, not thrown strings; the git adapter returns a typed
  result carrying git's own message, which the user must be able to read (the extension shows it, so we do).
- Names in the code use the vocabulary of `contracts/`, so the plan, the tasks, the types and the tests say
  the same words.

## Consequences

- The first slice cannot be "a hello window": it must land the rings, the dependency rule and the frozen
  `contracts/`, because everything after it depends on the seam. That is why it is alone in wave 1.
- The columnar store is more code than an array of objects, and its API is the one thing every later lane
  reads. It is worth it once, at 50 000 rows, and it is cheap now and expensive later.
- Testing is easier, not harder: `core/` needs no mocks, no Electron, no DOM, so unit tests are fast enough
  for mutation testing to be affordable.
- The budgets will make some slices fail their first attempt. That is the intent: a budget nobody ever hits
  is a budget that was set too loose to be useful.
- If the shell is ever replaced (ADR-0001's reversal path), `core/`, `ports/` and `contracts/` move
  unchanged. Only `app/` and `adapters/` are host-specific, which is roughly a tenth of the code.
