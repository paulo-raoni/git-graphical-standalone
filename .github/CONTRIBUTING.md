# Contributing to Trunks Graph

Thanks for wanting to help. This page is the short version. [`AGENTS.md`](../AGENTS.md) is the full contract,
and it wins wherever the two differ.

## The one rule you must not break: clean room

Trunks Graph reproduces the behaviour of the Git Graph extension for VS Code. Git Graph's licence does not allow
derivative works to be published, so this project must never contain any of its code or assets.

- Learn behaviour **only** by using the extension and by reading its public Marketplace page: the listing, the
  README, the licence, the changelog, and the settings and command lists.
- **Never** open, read, copy or translate its source code, styles, icons, images or strings, from any version
  (including the old MIT ones) or any fork. If you have read that source, say so in your issue or pull request
  before working on the same area.
- Don't commit screenshots or recordings of Git Graph. Describe its behaviour in your own words.

A contribution that breaks this rule cannot be accepted, however good it is.

## Ways to help

- **Try it and report.** Run it on your repositories, especially on macOS or Linux (#22), and open an issue for
  anything wrong. A screenshot of **Trunks Graph** helps.
- **Pick a roadmap item.** Every planned milestone is an issue labelled `roadmap`. Comment on it before starting,
  because milestones are planned and approved before work begins.
- **Improve the docs.** Anything unclear in the README or `docs/` is a bug.

## Building and checking

You need git and Node.js 24.18.0. Setup notes are in [`docs/SETUP.md`](../docs/SETUP.md).

```bash
npm ci
npm start -- /path/to/a/repository
npm run gates:quick      # every check except mutation testing
npm run gates            # those plus mutation testing (slow)
```

## Where things live

```
src/contracts/   shared data types and the IPC contract; depends on nothing
src/core/        pure domain logic and use cases
src/ports/       the interfaces the core needs from the world
src/adapters/    their implementations (git, files)
src/app/         the Electron main process, which wires everything
src/preload/     the typed bridge between the main process and the window
src/ui/          the renderer
test/            fixtures, end-to-end tests and gate tests
docs/            the plan, the decisions (ADR-*), setup notes
```

Dependencies point inward only, and a gate enforces it. The reasons are in
[`docs/ADR-0002-architecture-and-performance.md`](../docs/ADR-0002-architecture-and-performance.md).

## Pull requests

- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): subject`, a
  lower-case imperative subject of at most 72 characters, and body lines of at most 100.
- Everything in the repository is written in English.
- Keep a pull request to one change, with the checks passing (`npm run gates:quick`).
- No credentials, e-mail addresses or personal paths in committed files.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
