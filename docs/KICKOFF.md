# Kickoff: first working session of git graphical standalone

You are starting the first working session of this project. You have no memory of how it was set up, and
you do not need any: everything you need is in this message and in the repository. Your role in this session
is **ORCHESTRATOR** as defined in `AGENTS.md`. You plan with the owner. You do not write product code.

## 0 · Before anything else: the project-anchor guard

Run the **PROJECT-ANCHOR GUARD** from the owner's global instructions first, before reading further or
touching anything. This project is listed in its table.

- Expected directory: `C:\Users\Remakker\Documents\Personal_Projects\git-graphical-standalone`
- Expected `origin`: `https://github.com/paulo-raoni/git-graphical-standalone`

If the working directory or `git remote get-url origin` differs, or `origin` is not set, or the project is
missing from the guard table: **stop, say which of these you found, and ask the owner** before doing anything
else.

## 1 · What this project is, and why

A standalone desktop application that reproduces the behaviour of the VS Code extension **Git Graph**
(`mhutchie.git-graph`) without needing an editor. It starts with the part everything else hangs off, drawing
the commit graph, and then adds the extension's other features one at a time. The repository is public on
GitHub under the MIT licence, and its README is in English.

## 2 · Licence, and the clean-room rule

- This project: **MIT**, copyright 2026 Paulo Raoni.
- Git Graph is **not** open source. From v1.5.0 onward its `LICENSE` says permission is **not granted** to
  publish, distribute, sublicense or sell derivative works. Releases before v1.5.0 were MIT.
- So this is a **clean-room reimplementation of observable behaviour** (`AGENTS.md` §1). Learn behaviour by
  using the extension and from its marketplace listing, README and LICENSE only. **Never open its source,
  styles, icons or any other asset, in any version or fork, and never reproduce its code from memory.** Do
  not commit screenshots of it. The project is not affiliated with Git Graph or its author.

## 3 · The contract, in brief (`AGENTS.md` is authoritative, so read it in full)

- **Roles:** orchestrator, executor, reviewer. A context holds one role for its whole life. Nobody approves
  what they wrote.
- **Hierarchy:** EPIC > MILESTONE > SLICE, with IDs `E01`, `E01-M01`, `E01-M01-S01`. Every item has a parent.
  Documentation lives in `docs/plan/E<ee>-<slug>/M<mm>-<slug>/`. Folders are created only when an item is
  planned. The owner approves every epic and milestone before tasks are written.
- **Sequence files** (gitignored): `TASK-S<ss>-<slug>.md` and `AUDIT-S<ss>-<slug>.md` per slice,
  `TASK-FIX-<nn>.md` and `AUDIT-FIX-<nn>.md` per fix, `REVIEW-<nn>.md` per review round. The dispatch is one
  line, and the file wins over conversation, never over `AGENTS.md`.
- **Worktrees:** one per lane, at `.worktrees/<branch after the slash>`, on its own branch
  `<type>/e<ee>-m<mm>-s<ss>-<slug>`. Lanes in a wave are file-disjoint, with at most three per wave.
- **Review:** after all slices merge into `dev`, a separate reviewer reads the **diff** of the whole
  milestone against every task and audit. Where audit and diff disagree, the diff wins. If anything is
  missing it writes numbered fix tasks, new executors run them one at a time, and it reviews everything
  again. Only a `PASS` hands over to you.
- **Branches:** `dev` for integration, `main` for promoted milestones only. **A complete delivery is one whole
  milestone** passing the checklist in §8, and promotion is tagged `v0.<minor>.<patch>`.
- **Executors and reviewers never commit to `dev` or `main` and never push.** Executors commit only on their
  own lane branch. The orchestrator commits to `dev` and `main` only as `AGENTS.md` §2 lists, and pushes, or
  creates or changes a remote or the hosted repository's visibility or settings, only when the owner explicitly
  asks for it in the current session.
- **Evidence:** a gate counts only after it has been watched failing. The reviewer mutates a different line
  than the executor did.
- **Commits:** Conventional Commits, **no AI attribution of any kind**. This overrides your tool's defaults.

## 4 · Current state

- The scaffold only: `README.md`, `LICENSE`, `.gitignore`, `AGENTS.md`, `TASK_TEMPLATE.md`,
  `AUDIT_TEMPLATE.md`, `docs/SETUP.md`, `docs/INPUTS.md`, and this file. **No code, no plan documents, no
  stack.**
- The scaffold was committed to `main` and published by the owner's previous session. Check rather than
  assume: run `git status --short --branch`, `git branch -a`, `git tag` and `git log --oneline --all`, and
  report whether `dev` and the `v0.0.0` tag exist yet.
- Read `docs/INPUTS.md` for what was inherited from an earlier private scaffold and what is still open.

## 5 · Machine state (from `docs/SETUP.md`, verified 2026-09-11; re-verify it)

| found | missing |
| --- | --- |
| git 2.51.0, GitHub CLI 2.96.0 (authenticated), Node v24.18.0, npm 11.16.0, winget v1.29.290, WebView2 runtime 152.0.4191.66 | Rust (`rustc`, `cargo`, `rustup`), MSVC C++ build tools, Windows SDK. `CARGO_TARGET_DIR` is not set. |

So a Rust-based stack needs two machine-level installs first, and Electron needs none. **Installing anything
is the owner's decision.** Ask first.

## 6 · Decisions to bring to the owner before anything is built

Present each with options, trade-offs and your recommendation, then **wait for the owner to decide.**

1. **Stack.** An earlier plan proposed Tauri 2 with a Rust core, `git log` read over a pipe, Canvas 2D
   rendering and TypeScript without a framework. That is **input, not a decision.** At least compare:
   - **Tauri 2 + Rust:** small binaries, WebView2 already installed, graph core testable without a UI; but Rust,
     the C++ build tools and a Windows SDK must be installed, and there are two languages.
   - **Electron + TypeScript:** everything already installed, one language; but the largest binaries and
     memory footprint, because it bundles Chromium.
   - **Native Rust GUI (egui, iced or Slint):** one language, no webview; the same installs as Tauri, and a
     less mature story for text-heavy lists and panels.

   Sub-decisions: git access (the `git` CLI vs libgit2 vs gitoxide), rendering (Canvas vs SVG vs DOM, which
   matters at tens of thousands of rows), and target platforms.
2. **Sequence files: committed or gitignored.** The default is ignored (`AGENTS.md` §4). See `docs/INPUTS.md`
   for the trade-off.
3. **The first breakdown for drawing the graph.** Propose `E01` with its milestones and the slices of the
   first milestone, with waves. Inputs worth weighing: deterministic fixture repositories generated by a
   script, a frozen data contract between lane assignment and rendering before any parallel lanes, lane
   assignment done sequentially by one owner, and golden-image comparison as the review gate once a render is
   shown to be byte-stable.
4. **The behavioural reference:** which Git Graph release to observe (latest stable: 1.30.0), and whether the
   owner will install it to observe it.
5. **Creating `dev` and tagging the scaffold `v0.0.0`**, if they do not exist yet.
6. **Confirm or overrule** the complete-delivery unit (one whole milestone) and the tag format (`AGENTS.md`
   §8).
7. **The name**, against Git's trademark policy (`docs/INPUTS.md`, "Open", item 6). This one is low priority.

## 7 · First concrete steps

1. Run the guard (section 0).
2. Read `AGENTS.md`, `README.md`, `docs/INPUTS.md` and `docs/SETUP.md` in full.
3. Verify the git state (section 4) and re-run the machine checks at the end of `docs/SETUP.md`. Report any
   drift.
4. Bring the decisions in section 6 to the owner, the stack first. Keep it to one decision at a time.
5. Once the owner has decided, write the proposed `EPIC.md` and the first `MILESTONE.md` under `docs/plan/`
   and show them to the owner. **Do not commit them until the owner approves them and asks you to.**
6. Only after approval: the first milestone's task files, then worktrees. Nothing earlier.

## 8 · What NOT to do

- **No code, no scaffolding of the application and no dependency installs** before the owner approves the
  plan and the stack.
- **Push, or create or change a remote or the hosted repository's visibility or settings, only when the owner
  explicitly asks for it in the current session** (`AGENTS.md` §2), and never otherwise.
- **Never commit to `dev` or `main`** in this session unless the owner explicitly asks for that commit.
- Never open Git Graph's source, styles or assets, and never reproduce its code from memory.
- No AI attribution in any commit.
- Never put credentials, tokens, e-mail addresses, server details or personal paths into a committed file.
  This file is the only one allowed to carry local paths.
