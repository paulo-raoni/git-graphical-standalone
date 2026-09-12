# git graphical standalone

A standalone desktop application that reproduces the behaviour of the
[Git Graph](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) extension for Visual
Studio Code, without needing an editor. It starts with the part everything else hangs off — drawing the
commit graph — and adds the extension's other features one at a time.

## Status

**Pre-alpha. It does not read a repository yet.** The first milestone is being built: the application
starts and opens a window, and the structure, the data contracts and the quality gates the rest stands on
are in place. Nothing about a git repository is displayed so far.

The stack is decided and is **Electron with TypeScript**, reading git through its command-line interface.
The reasoning, including why a lighter shell was weighed and not taken, is in
[`docs/ADR-0001-stack.md`](docs/ADR-0001-stack.md).

**Requirements to build:** git, Node and npm. Nothing else. See [`docs/SETUP.md`](docs/SETUP.md).

```
npm ci
npm run gates    # every quality gate
npm start        # open the application
```

Windows is the platform the application is built and verified on for now. The code is written
cross-platform, and macOS and Linux builds are a later milestone.

## Not affiliated

This project is independent. It is **not affiliated with, endorsed by or sponsored by** Git Graph, its author
(mhutchie), or Microsoft. Product names are used only to describe the behaviour this application aims to
reproduce.

## Clean-room reimplementation

Git Graph's licence is not an open-source licence. Since version 1.5.0 its `LICENSE` grants permission to use,
copy, modify and merge the software but states that permission is **not granted** to publish, distribute,
sublicense or sell derivative works of it. This project is published, so it cannot be a derivative work.

It is therefore a **clean-room reimplementation of observable behaviour**:

- Behaviour is learned by **using** the extension and by reading its public user-facing description, and is
  written down here in our own words.
- **Nothing is taken from its repository** — no source code, styles, icons, images, strings or other assets —
  and contributors do not read its source while working on this project. This applies to every version of
  Git Graph, including the early MIT-licensed ones, and to every fork of it.
- Code is never reproduced from memory of that source either.

The full rule, and how it is checked in review, is in [`AGENTS.md`](AGENTS.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) before planning, writing or reviewing anything. It is the workflow contract
and it is authoritative: how work is planned (epic, milestone, slice), how it moves through worktrees and
branches, how it is reviewed, and what counts as a complete delivery.

Setup notes for building locally are in [`docs/SETUP.md`](docs/SETUP.md). They describe requirements, not a
build, because there is nothing to build yet.

## Layout

```
AGENTS.md            the workflow contract (authoritative)
TASK_TEMPLATE.md     the shape of every task file
AUDIT_TEMPLATE.md    the shape of every audit file
src/contracts/       the shared data types and the IPC contract; depends on nothing
src/core/            pure domain and use cases; no I/O, no Electron, no DOM
src/ports/           the interfaces core needs from the world
src/adapters/        implementations of those interfaces
src/app/             the composition root: the Electron main process
src/preload/         the typed bridge between the main process and the renderer
src/ui/              the renderer
docs/PLAN.md         every behaviour to reproduce, as epics, milestones and slices
docs/ADR-*.md        the decisions: the stack, the architecture and budgets, the quality gates
docs/plan/           the epic and milestone in flight
docs/SETUP.md        what has to be installed, and what was verified on the development machine
docs/INPUTS.md       what this project inherited, what it changed, and what is still open
docs/KICKOFF.md      the opening brief for the first working session
LICENSE              MIT
```

Dependencies point inward only, and a gate enforces it rather than a convention.
[`docs/ADR-0002-architecture-and-performance.md`](docs/ADR-0002-architecture-and-performance.md) explains the
rings and carries the CPU and memory budgets every change is measured against.

## Licence

[MIT](LICENSE) © 2026 Paulo Raoni.
