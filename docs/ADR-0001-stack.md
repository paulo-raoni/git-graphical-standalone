# ADR-0001 · The stack

**Status:** proposed, awaiting the owner's approval (`AGENTS.md` §2). Once approved, this file is the
decision; a later change is a new ADR that supersedes this one, never an edit that rewrites history.

**Date:** 2026-09-11

## Context

The application reproduces the observable behaviour of the Git Graph extension outside an editor
(`docs/PLAN.md` holds the inventory). Whatever stack is chosen has to carry, at minimum:

- a window with a scrollable table whose first column is a drawn commit graph, holding **tens of thousands of
  rows** once a user keeps pressing "Load More Commits";
- read access to a repository: commits in three orderings, refs, stashes, the working tree state, file
  contents at a revision, diffs;
- write access later: every branch, tag, commit, stash and remote action of the inventory, including ones
  that need the user's own configuration to work (hooks, credential helpers, signing, `diff.tool`,
  `.mailmap`, config `include` directives);
- a development process run by agents in **file-disjoint lanes**, three at a time, each proving its gates
  (`AGENTS.md` §5, §7). A stack with two languages doubles the toolchains, the test runners and the surface
  an executor has to hold in one context.

The development machine (`docs/SETUP.md`, re-verified today) has git, Node 24, npm, VS Code and the WebView2
runtime. It does **not** have Rust, the MSVC C++ build tools or a Windows SDK. Those are two machine-level
installs, several gigabytes, and the owner's call.

`docs/INPUTS.md` records an earlier proposal, called braidline here: Tauri 2, a Rust core, `git log` read
over a pipe, Canvas 2D rendering, TypeScript with no framework. It was an input with reasons, not a decision.
This ADR takes each of its five choices in turn.

## Decision drivers, in order

1. **Behaviour parity** with the extension, including behaviour that depends on the user's git configuration.
2. **Scale**: the view must stay responsive at tens of thousands of loaded rows.
3. **Clean room** (`AGENTS.md` §1): nothing here may make provenance arguable.
4. **One lane, one context**: an executor should be able to hold the whole slice in one language.
5. **Cost to start**: what has to be installed before the first gate can run.
6. **Footprint: CPU and memory.** Raised by the owner to the top of the list after this ADR was first
   drafted; answered in Axis 6 and turned into numbers by `docs/ADR-0002-architecture-and-performance.md`.
7. **Cross-platform reach**, at the cost the owner accepts (`docs/PLAN.md`, owner decisions).

## Axis 1 · Git access

| option | for | against |
| --- | --- | --- |
| **`git` CLI, spawned per request, output streamed over a pipe** | It is what the extension itself observably does: its Changelog says its output log "includes all Git commands that are run", and every inventory item maps to a git command. The user's configuration works unchanged: hooks, credential helpers (askpass), GPG and X.509 signing, `.mailmap`, `include` directives, `diff.tool`. Interactive rebase is only possible this way. No native compilation. | A process per call costs tens of milliseconds. Output is text we parse, so formats must be chosen with unambiguous separators. Behaviour varies across git releases, so a version floor has to be stated and checked. |
| libgit2 through bindings (`nodegit` from Node, `git2` from Rust) | In-process object walks are fast; no parsing. | On Node it is a native module needing the MSVC toolchain the machine lacks, and its maintenance is thin. libgit2 is a second implementation of git: it does not run hooks or credential helpers, does not sign, does not do interactive rebase, and diverges from git in stash and rebase corners. Each divergence becomes a bug that is ours. Commit orderings (`--topo-order`, `--author-date-order`) would have to be reimplemented and proven equal to git's. |
| gitoxide (`gix`) | Fast, memory-safe, actively developed. | Rust only, so it forces the Tauri path. Write operations are still incomplete, so the CLI would be needed anyway for most of E05, leaving two code paths to keep equivalent. |

**Decision: the `git` CLI.** Long outputs are streamed and parsed incrementally rather than buffered.
Records use the ASCII record and unit separators (`%x1e`, `%x1f`) in `git log --format`, `-z` termination
for `status --porcelain=v2`, and a fixed `--format` for `for-each-ref` and `stash list`. The git version
floor is measured and recorded in `docs/SETUP.md` by the slice that lands the git service; the Changelog's
own mentions stop at git 2.25, so the floor will not be lower than that. The executable is discovered the
way the inventory describes (a configured path, then `PATH`, then the usual install locations), never
assumed.

## Axis 2 · Rendering, and what decides behaviour at tens of thousands of rows

Three things decide it, and the medium is only the third:

1. **The layout algorithm must be linear and incremental.** Lane assignment walks the commits once, in the
   order git returned them, and "Load More" appends rows without recomputing the prefix. Anything quadratic
   in the row count fails at the second page.
2. **Draw cost must depend on the viewport, not the row count.** Only rows that are on screen, plus an
   overscan margin, may exist or be drawn. This holds for every medium below; a medium that cannot be
   virtualised is out.
3. **The per-row model must be compact**, because it is retained for every loaded row while only a few
   dozen are visible.

| medium | at tens of thousands of rows |
| --- | --- |
| DOM, one element tree per row, no virtualisation | Hundreds of thousands of nodes; layout and paint scale with the total. Out. |
| SVG for the graph column | Element count grows with rows and edges. It can be virtualised, but the text columns still need the DOM, so SVG only adds a second retained tree. Out. |
| Canvas 2D for the whole table (braidline) | Draw cost is the viewport, which is right. But text in canvas loses selection, IME, screen readers, native ellipsis and per-element context menus; every ref label becomes hit-testing code we write; font metrics and high-DPI scaling are manual. The inventory has ref labels with their own context menus, hover tooltips, resizable columns and a column-header context menu. Paying for all of that in canvas buys nothing. Out as the whole medium. |
| **Hybrid: virtualised DOM rows for Description, Date, Author and Commit; one viewport-sized Canvas 2D for the Graph column** | The DOM holds only visible rows, so text keeps every native behaviour. The canvas is one element the size of the viewport, redrawn from the precomputed layout on scroll; vertex hit-testing is arithmetic (row from `y`, lane from `x`). Both are driven by one scroll offset. |

**Decision: the hybrid.** This keeps braidline's Canvas 2D where it earns its place, the graph column, and
replaces it with the DOM where canvas would cost behaviour.

**Golden images.** braidline proposed golden-image comparison as the mechanical gate for the renderer, after
first confirming a render is byte-stable across runs. Electron's bundled Chromium makes that plausible on
one machine; across machines, font rasterisation differs. A slice in the first milestone measures stability
on this machine before any golden becomes a gate, and records whether the comparison is exact or tolerant.
Until then, renderer gates are unit tests over the layout model plus an end-to-end run that opens the window
and reads the rendered state.

## Axis 3 · The shell

| option | for | against |
| --- | --- | --- |
| Tauri 2, Rust core (braidline) | Small distributable (about a tenth of Electron's), low memory, uses the WebView2 already on the machine. | Needs Rust **and** the MSVC toolchain with a Windows SDK: two installs the machine lacks, before one line compiles (driver 5). Two languages across an IPC boundary for every feature (driver 4). Given Axis 1, the Rust core would be thin: spawn git, parse text, forward. Rust buys binary size, little else. Three different webviews across platforms (WebView2, WKWebView, WebKitGTK) rasterise canvas text differently, which turns one renderer into three to verify and makes golden images per platform. Builds across three worktrees need a shared `CARGO_TARGET_DIR`. |
| **Electron, TypeScript end to end** | Everything needed is installed today (driver 5). One language, one test runner, one lint (driver 4). One Chromium on every platform, so one renderer to verify (driver 2). Mature process model: a main process owns git and the file system, a sandboxed renderer owns the view, a preload exposes a typed bridge. Playwright drives Electron, which is how "open the actual thing" becomes a repeatable gate. Precedent: GitHub Desktop is Electron over the git CLI; VS Code, the extension's own host, is Electron. | Distributable well over 100 MB and higher idle memory (driver 6). A new major every eight weeks, with fixes for the last three; we pin a major and move once per milestone at most. |
| Native Rust GUI (egui, iced, Slint) | Smallest, fastest. | Same two installs. Text layout, IME and accessibility are weaker than a browser engine's, and the inventory is text-heavy. |
| .NET with Avalonia, or Qt | Mature desktop toolkits. | Neither runtime is on the machine (`dotnet` is missing), and each is a new language. Nothing in the inventory needs them. |

**Decision: Electron.** Pinned to the current stable major when the scaffold slice lands (43.x as of this
date; the executor records the exact version and Chromium and Node it bundles). The renderer never touches
Node: everything crosses a **typed IPC contract** in a shared module, so the shell stays replaceable. If
distributable size becomes the complaint, a Tauri host that implements the same contract can carry the
renderer unchanged; that is the reversal path, and it is why the contract, not the framework, is the thing
we freeze.

## Axis 4 · Language, framework and tooling

- **TypeScript, strict mode**, in all three processes. Confirmed from braidline.
- **No UI framework.** Confirmed from braidline, with the reason made explicit: the view is a small number of
  large components (the virtualised table, the graph canvas, dropdowns, dialogs, context menus, the details
  panel), and virtualisation fights a reconciler that wants to own the DOM. Plain modules also keep lanes
  file-disjoint, which a framework's shared registration points (routers, stores) work against. This is the
  decision most likely to be revisited when E04 and E05 add many dialogs; a revisit is a new ADR.
- **esbuild** to bundle main, preload and renderer. **Vitest** for unit tests. **Playwright** for end-to-end
  runs against the built Electron app. **ESLint with typescript-eslint** for lint. **electron-builder** for
  installers, added by the packaging epic and not before. Exact versions are pinned in the lockfile by the
  scaffold slice and never in this file.
- Dependencies are added only by a task that names them (`AGENTS.md` §2). The runtime dependency list is
  expected to stay at Electron alone for the MVP.

## Axis 5 · Target platforms

The code is written cross-platform from the first slice: no shell strings, path handling through Node's
`path`, git discovery per operating system, line endings normalised at the parser. It is **built, run and
reviewed on Windows only** for the MVP, because "open the actual thing" (`AGENTS.md` §7) can only happen on
this machine. Linux and macOS packaging and verification are a later milestone that the owner enables; until
then the README says so. This is owner decision 2 in `docs/PLAN.md`; the default recorded here is
"cross-platform code, Windows-verified", and it costs nothing extra now.

## Axis 6 · The lightweight requirement, re-examined

The owner has since put **CPU efficiency and memory allocation above feature count**: as light as possible,
with the whole repository still explorable. That is a direct challenge to this ADR's accepted cost, so it is
answered here rather than left in the Consequences.

**What the shell actually costs, on Windows.** Both candidates render in Chromium: Electron bundles it,
Tauri drives the WebView2 runtime, which is Chromium. So the rendering and scripting engine, and therefore
the cost of our own drawing and scrolling, is **the same in both**. The difference is a roughly fixed
baseline:

| | Electron | Tauri 2 on Windows |
| --- | --- | --- |
| Resident memory, application idle, one window | about 120 to 200 MB across its processes | about 60 to 110 MB, part of it in a WebView2 runtime shared with other applications |
| Installed size | about 150 to 200 MB | about 5 to 15 MB, plus the already-present runtime |
| Memory for 50 000 loaded commits, under ADR-0002's store | about 5 to 10 MB | the same |
| Rendering and scrolling cost | Chromium | Chromium |
| Parsing 50 000 commits, once per load | roughly 200 to 400 ms in optimised TypeScript | roughly 80 to 150 ms in Rust |

Two things follow, and they matter more than the headline.

1. **The difference is a constant, not a slope.** Electron costs on the order of 60 to 100 MB more at rest
   and around 150 MB more on disk, and that gap does not widen with repository size. What *does* scale is
   the commit store, the DOM row count and the redraw policy, and those are identical in both candidates
   and are governed by ADR-0002's budgets. An Electron application that obeys those budgets is lighter under
   load than a Tauri application that does not.
2. **Rust's parsing advantage is real and small in a session.** It is one or two hundred milliseconds, once
   per load, against two machine-level installs, a second language across every lane, and three different
   webviews to verify once the project leaves Windows.

**Decision: Electron stands, and the lightweight requirement is met by ADR-0002's budgets rather than by the
shell.** The measurements are taken for real at E07-M01, and the reversal trigger is written down now: if
the packaged application exceeds **400 MB resident with 50 000 commits loaded** or **250 MB installed**, or
if the owner judges the idle footprint unacceptable once he has seen it, the host is reconsidered. The typed
IPC contract is what makes that a contained change: `core/`, `ports/` and `contracts/` move unchanged, and
only `app/` and `adapters/` are host-specific.

**This is the one point of this plan where the owner may reasonably decide otherwise**, and now is the
cheapest moment: no code exists. Choosing Tauri costs two installs on the development machine (the Rust
toolchain, and the Microsoft C++ build tools with a Windows SDK) before the first gate can run, and adds
`cargo` gates, `cargo-mutants` for the Rust half and per-platform golden images to ADR-0003.

## Consequences

- **No machine install is needed.** Phase 2 can start the moment this ADR and the plan are approved.
- The scaffold slice trims the Rust block from `.gitignore` and adds the chosen stack's rows to
  `docs/SETUP.md`, including the measured git version floor.
- The typed IPC contract and the graph data contract (commits, refs, layout rows) are frozen by the first
  slice, before any parallel lane, as braidline advised.
- Distributable size is accepted as the price of drivers 4 and 5, within the reversal trigger of Axis 6. It
  is measured at the packaging epic and recorded there, so the reversal can be weighed against a number
  rather than a feeling.
- **Everything that scales with repository size is governed by
  `docs/ADR-0002-architecture-and-performance.md`**, and every budget in it is enforced by a gate in
  `docs/ADR-0003-quality-gates-and-ci.md`. This ADR chooses the host; those two are what make the result
  light.
- Electron's release cadence means one dependency bump per milestone at most, done by a slice with the
  end-to-end gate as its evidence.

## What was confirmed and what was replaced from braidline

| braidline | here |
| --- | --- |
| `git log` over a pipe | **confirmed**, extended to every git read and write |
| TypeScript, no framework | **confirmed**, with the reason and the revisit condition stated |
| Canvas 2D | **narrowed** to the graph column; virtualised DOM for the text columns |
| Tauri 2 | **replaced** by Electron |
| Rust core | **replaced** by a Node main process; the Rust core would have been a thin wrapper around the CLI |
