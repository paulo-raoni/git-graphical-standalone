# Plan

This file is the **map**: the behaviour to reproduce, organised as EPIC > MILESTONE > SLICE (`AGENTS.md`
§3), with the MVP cut marked. It is deliberately the only place the whole tree is written. Scope and boundary
of a slice live **only** in its task file; `docs/plan/E<ee>-<slug>/M<mm>-<slug>/` holds only the item in
flight. Nothing in this file is a specification.

**Status:** **approved** by the owner on 2026-09-11: this plan, the MVP cut, and the three architecture
decision records it rests on, `docs/ADR-0001-stack.md` (the stack),
`docs/ADR-0002-architecture-and-performance.md` (the rings, the data representation and the budgets) and
`docs/ADR-0003-quality-gates-and-ci.md` (the gates, the regression ratchet and the workflow).
`AGENTS.md` §2 applies: inside the MVP, epics and milestones then need no further approval.

## 1 · Sources of the inventory

Everything in §2 comes from the extension's Marketplace page as read on 2026-09-11: its listing, its
Changelog (versions 1.0.0 to 1.30.0, the last, dated 2021-04-05), its settings list and its command list.
Nothing else was opened (`AGENTS.md` §1). Behaviours are written in this repository's own words. Where the
Marketplace names a setting, the setting name is quoted because a user of the extension knows it by that
name; that is the extent of what is quoted.

Two things the Marketplace page gives only in part: default values of settings (the Changelog names a
few), and the exact wording of dialogs and menus. Both are learned by **observing** the extension, which is
installed on the development machine at version 1.30.0, and are recorded in each task file's reference behaviour when the slice is cut.

## 2 · Behaviour inventory, by epic

Each line is one observable behaviour. The tag at the end names the milestone that delivers it. **MVP**
marks the milestones of the MVP cut (§4).

### E01 · The commit graph

The table whose first column is the drawn graph, with Description, Date, Author and Commit columns.

**Loading and content**
- Commits of the selected branches are loaded from the repository in pages: an initial count, then more per
  "Load More Commits" press (`repository.commits.initialLoad`, `loadMore`). The button shows only when more
  exist. → M01 **MVP**
- More commits load automatically when scrolled to the bottom (`loadMoreAutomatically`). → M03
- Local branches, remote branches, tags and remote HEAD symbolic references are shown as labels on their
  commits; each can be switched off (`showRemoteBranches`, `showTags`, `showRemoteHeads`). → M01 **MVP**
  (heads, remotes, tags shown); M02 (toggles, remote heads)
- Commits reachable only from tags are included (`showCommitsOnlyReferencedByTags`). → M02
- Stashes appear as rows, drawn differently from commits, including stashes based on commits of deleted
  branches (`showStashes`). → M02
- Uncommitted changes appear as a row at the top when present, counted from the working tree and,
  optionally, untracked files (`showUncommittedChanges`, `showUntrackedFiles`). → M01 **MVP**
- Commit order is date, author-date or topological (`commits.order`), overridable per repository from the
  column-header context menu. → M02
- Only the first parent can be followed (`onlyFollowFirstParent`); commits mentioned only by reflogs can be
  included when showing all branches (`includeCommitsMentionedByReflogs`). → M02
- When showing all branches, a detached HEAD not on any branch (for example mid-rebase) is included. → M01 **MVP**
- Author and committer names respect `.mailmap` when enabled (`useMailmap`). → M02

**Drawing**
- Each commit is a vertex in a lane; edges to parents are drawn in the lane's colour; lanes are assigned so
  branches and intermediate merges read clearly, and lines past the rightmost vertex are not cropped. → M01 **MVP**
- Graph colours and graph style are configurable (`graph.colours`, `graph.style`). → M02
- The commit at HEAD is emphasised, and shown as a hollow circle with a tooltip explaining it. → M02
- Uncommitted changes are drawn either as an open grey circle joined to HEAD by a solid grey line, or as a
  closed circle joined by a dotted line with HEAD drawn open (`graph.uncommittedChanges`). → M02
- Merge commits, and commits that are not ancestors of HEAD, can be muted (`commits.mute.*`). → M02
- Hovering a vertex shows whether the commit is in HEAD and which branches, tags and stashes contain it. → M02
- Rendering stays aligned when the window is zoomed and at high DPI. → M01 **MVP**

**Reference labels**
- Labels carry the branch colour; the checked-out branch's label is emphasised more. → M01 **MVP** (colour);
  M02 (emphasis)
- Alignment: normal, branches left and tags right, or branches aligned to the graph with tags right
  (`referenceLabels.alignment`). → M02
- A local and a remote branch on the same commit with the same name combine into one label with two
  sections (`combineLocalAndRemoteBranchLabels`). → M02

**Columns**
- Date column shows author or commit date (`date.type`) in one of several formats including ISO date-time
  and ISO date (`date.format`). → M01 **MVP** (one default format); M02 (settings)
- Columns are resizable by dragging header dividers; Date, Author and Commit can be shown or hidden from
  the header context menu, with defaults (`defaultColumnVisibility`); narrow views get sensible automatic
  widths. → M02

**Messages**
- Emoji shortcodes, including the gitmoji set, are replaced by emoji; custom mappings can be added
  (`customEmojiShortcodeMappings`). → M04
- A subset of inline Markdown (bold, italic, bold-italic, inline code) renders in messages and tag details,
  and inline code never changes row height (`markdown`). → M04
- Issue references become links according to the repository's issue-linking rule (see E06-M02). → M04
- Author and committer avatars are fetched from GitHub, GitLab or Gravatar, cached, refreshed in the
  background, at high-DPI resolution, and the cache can be cleared (`fetchAvatars`). → M04

**Refresh and navigation**
- The view refreshes automatically when the repository changes while visible; a refresh button shows when a
  refresh is running; a running git action is named while it runs; scroll position is kept across
  refreshes and actions. → M01 **MVP** (manual refresh); M03 (the rest)
- On load the view can scroll to centre on HEAD (`onLoad.scrollToHead`); a shortcut centres on HEAD and
  flashes it; shortcuts jump to the next or previous stash; Up and Down scroll the view; a shortcut
  refreshes. → M03
- Every shortcut is rebindable, or can be set to unassigned (`keyboardShortcut.*`). → M03

Milestones:

| ID | title | outcome |
| --- | --- | --- |
| **E01-M01** | First graph | Open a repository and see its commit graph with refs, uncommitted changes and Load More. **MVP** |
| E01-M02 | Graph fidelity | Every drawing, label, column and ordering option of the inventory. |
| E01-M03 | Live view | Auto-refresh, navigation shortcuts, auto-load, rebindable keys. |
| E01-M04 | Message rendering | Emoji, Markdown subset, issue links, avatars. |

Slices of **E01-M01**, in dispatch order. Waves 1 and 2 build the ground the rest stands on: the rings and
the frozen contract of `docs/ADR-0002-architecture-and-performance.md`, then the gate pipeline of
`docs/ADR-0003-quality-gates-and-ci.md`. They are single-lane on purpose, because everything after them
depends on both.

| ID | title | wave | outcome |
| --- | --- | --- | --- |
| E01-M01-S01 | scaffold, rings and the frozen contract | 1 | The project with its four rings, the dependency rule enforced mechanically, **every development dependency of the milestone pinned in one lockfile**, the frozen types for commits, refs, layout rows and the IPC bridge, the static gates, and a window that opens. |
| E01-M01-S02 | gate pipeline, the commit store and CI | 2 | The columnar commit store, the first real module of `core`, with its 96-byte budget proved by benchmark; unit and coverage thresholds, StrykerJS with its thresholds, the Playwright harness, the benchmark harness and its baseline mechanism, deterministic fixture repositories generated by script, `npm run gates`, and the single grouped workflow. |
| E01-M01-S03 | git read adapter and the log parser | 3 | Discover git; stream log, refs, status and stash list, parsed incrementally into the store, with the git version floor measured and recorded. |
| E01-M01-S04 | lane layout engine | 3 | The single-pass, incremental lane assignment from the store to layout rows, with unit tests over fixture shapes. |
| E01-M01-S08 | the contract decode API | 3 | Move the pure decoders of `CommitColumns` out of `core` and into `contracts`, where the renderer can reach them. |
| E01-M01-S05 | graph table renderer | 4 | Recycled virtualised rows and the coalesced graph canvas, drawing layout buffers supplied as fixture data, with ref labels and the uncommitted row. |
| E01-M01-S06 | open a repository | 5 | The composition root: open by argument or folder dialog, initial load, Load More, refresh, and the error page when git is missing. |
| E01-M01-S09 | the mutation gate's two clocks | 5 | Choose the test runner's inner timeout and make it coherent with the mutation runner's budget, so the gate stops measuring the machine. |
| E01-M01-S07 | budgets, baselines and render stability | 6 | Measure the assembled application against every budget of ADR-0002, commit the baselines, and settle whether a render is byte-stable enough for golden images on this machine. |
| E01-M01-S10 | fit fifty thousand commits in the memory budget | 6 | Bring the assembled application at 50 000 loaded commits inside the memory budget as decision 6 first stated it (the sum of the working sets), which S07 measured it over, or show by measurement which recorded decision stands in the way. |
| E01-M01-S11 | gate tiers and the budgets gate | 7 | Land the gate scripts of AGENTS.md §11 so that a lane runs the gates its change can move, and the wall-clock budgets run as their own gate on a free machine. |
| E01-M01-S12 | the mutation gate without per-file isolation | 7 | Run the mutation gate without isolating test files from each other, if every mutant keeps its verdict, to bring its hour and a half down. |

Later milestones are sliced when they come in flight.

### E02 · Repositories and the application shell

What the editor provided around the extension, rebuilt as a desktop application.

- Open a repository by choosing a folder, by command-line argument, or from a list of recent repositories;
  the last viewed one opens on start. → M01
- Several repositories can be known at once and switched with a dropdown that has a filter, shows the full
  path as a tooltip, adds path hints when names collide, allows a custom name, and sorts by a configurable
  order (`repositoryDropdownOrder`). → M01
- Repositories in subfolders are discovered to a configurable depth (`maxDepthOfRepoSearch`); submodules
  listed in `.gitmodules` are added automatically; repositories can be added and removed by command, and a
  known sub-repository shown in a file tree opens when clicked. → M01
- The git executable is found like the editor finds it: a configured path (single or a list), portable
  installs, `PATH`; switching the setting to a valid executable takes effect; two distinct error pages
  explain a missing executable or an unloadable repository with actions. → M02
- Every git command run is logged to a log the user can open; a command shows version information and
  copies it. → M02
- Remote operations that ask for credentials prompt the user (askpass). → M02
- A terminal can be opened for the repository, with a configurable shell (`integratedTerminalShell`); it is
  also what interactive rebase runs in. → M02
- Symbolic links in repository paths are resolved; repositories on mapped network drives on Windows work. → M02
- Settings exist for everything the inventory names, at user scope and, where the extension allowed a
  workspace-folder scope, per repository; there is a settings UI; renamed settings keep old values working. → M03
- Themes: light, dark and high contrast, including the text-selection colour. → M03

| ID | title | outcome |
| --- | --- | --- |
| E02-M01 | Repository management | Open, remember, switch, discover and remove repositories. |
| E02-M02 | Git executable and diagnostics | Discovery, error pages, command log, version info, askpass, terminal. |
| E02-M03 | Settings and themes | Every setting with scopes and a UI; three themes. |

### E03 · Branch filtering and find

- A Branches dropdown offers Show All, multi-selection of branches, a filter box, and predefined glob
  patterns (`customBranchGlobPatterns`); double-clicking Show All toggles every branch; a branch's context
  menu can select or unselect it; the selection persists per repository. → M01 **MVP** (all but glob
  patterns and the context-menu action, which need E05-M01)
- A Show Remote Branches checkbox, persisted per repository (`showRemoteBranches`), and per-remote
  visibility from the repository settings (E06-M01). → M01 **MVP** (checkbox)
- Repositories with over a thousand branches or very many tags load; colour codes from `color.branch=always`
  never leak into names; remote svn branches display. → M01 **MVP**
- A Find widget (shortcut, or button on the control bar) matches a phrase against message, date, author,
  hash, branch and tag names; Enter and Shift+Enter move between matches; a mode button also opens the
  Commit Details View on each match. → M02

| ID | title | outcome |
| --- | --- | --- |
| **E03-M01** | Branches dropdown | Show all, select, filter, remote toggle, persistence. **MVP** |
| E03-M02 | Find widget | Phrase search across the loaded commits with navigation. |

### E04 · Commit details, comparison and diff

- Clicking a commit opens the Commit Details View, inline under the row or docked at the bottom
  (`commitDetailsView.location`), optionally auto-centred (`autoCenter`); Escape closes it. → M01 **MVP**
- It shows hash, parents (clickable when loaded), author and committer with both dates when they differ,
  emails, and the full body with leading whitespace preserved. → M01 **MVP**
- Changed files appear as a tree or a list (`fileView.type`), switchable per repository from controls on
  the view; folders with a single child folder compact (`compactFolders`); merge commits show the right
  files; filenames with quotes, non-ASCII and URI separators work; A, M, D, R, U indicators can be shown
  (`enhancedAccessibility`). → M01 **MVP**
- The view's height and divider are draggable and remembered per repository. → M01 **MVP**
- Up and Down move to the adjacent row; Ctrl/Cmd+Up and Down move to the child or parent on the same
  branch; with Shift the alternative branch is followed at forks and merges. → M01 **MVP**
- Per file: copy path, copy relative path, open the current version (following renames), and a file context
  menu holding every file action. → M01 **MVP**
- The uncommitted changes row opens as a details view; a stash's details include its untracked files. → M01 **MVP**
- Clicking a file shows its diff for that commit; a file can be viewed at that revision; the diff with the
  working file can be shown; file contents are decoded with a configurable encoding (`fileEncoding`); a
  directory diff opens in the user's `diff.tool` or `diff.guitool`. → M02
- Ctrl/Cmd-clicking a second commit opens the Commit Comparison View with the changes between the two and
  the same file actions; any commit can be compared with the uncommitted changes. → M03
- Code Review: a button starts and ends a review on a commit or a comparison (not on uncommitted changes);
  unreviewed files are bold and un-bold when viewed; files can be marked reviewed or not from the file
  menu; the last viewed file carries an eye marker; reviews persist across sessions, expire after 90 days of
  inactivity, and can be resumed or ended from commands. → M04
- In the body: URLs open in the browser, commit hashes open that commit's details, author emails and links
  have a copy-URL context menu; signature status shows next to the committer with a tooltip
  (`showSignatureStatus`); emoji, Markdown and issue links render as in the graph. → M05

| ID | title | outcome |
| --- | --- | --- |
| **E04-M01** | Commit Details View | Details and changed files for a commit, stash or the working tree, with keyboard navigation. **MVP** |
| E04-M02 | Diff and file viewer | Diff of a file at a commit, file at revision, working-file diff, encodings, external diff tool. |
| E04-M03 | Commit comparison | Changes between any two commits or against the working tree. |
| E04-M04 | Code review | Reviewed-file tracking that persists. |
| E04-M05 | Rich details | Links, hash links, signature status, rendered messages. |

### E05 · Git actions from the graph

Every action is reached from a right-click context menu on a commit, branch, remote branch, tag, stash or
the uncommitted changes row, or from the control bar.

**Framework**
- Context menus close on the next interaction, use dividers and trailing ellipses for actions that open a
  dialog, and hide actions per a visibility setting (`contextMenuActionsVisibility`). → M01
- Dialogs use custom controls in the app's theme; Enter submits the primary action, including through CJK
  input methods; Escape closes; dropdowns scroll; reference inputs can substitute spaces with hyphens or
  underscores (`dialog.general.referenceInputSpaceSubstitution`); each dialog's defaults are settings
  (`dialog.*`); dialogs that act on the current branch name it. → M01
- Errors from git show in a dialog; the running action's name is shown; scroll position is kept. → M01
- Read-only actions: copy commit hash and subject, copy branch, tag and stash names and stash hashes; view
  annotated tag details (name, email, date, message, object and commit hashes); create a tar or zip archive
  at a branch or tag. → M01

**Branches**
- Create a branch from a commit or stash, optionally checking it out; a name that already exists offers to
  replace it or choose another. → M02
- Checkout, also by double-clicking a label; checkout and delete are absent from the checked-out branch's
  menu. → M02
- Rename; delete with Force, with a one-click force follow-up when not fully merged, and optionally on the
  remotes that have it. → M02
- Reset the current branch to a commit (soft, mixed, hard). → M02
- Push with Force or Force With Lease, to one or several remotes; the default remote follows
  `remote.pushDefault`, `branch.<name>.remote` and `branch.<name>.pushRemote`, else origin. → M02
- Merge into the current branch from a branch, remote branch or commit, with Squash, No Commit and a choice
  of squash message format; Pull into the current branch with the same options. → M02
- Rebase the current branch onto a branch or commit; interactive rebase runs in a terminal. → M02
- Remote branch: checkout (offering another name, or checking out the existing local branch and pulling,
  when the name exists); delete, silently removing the tracking ref when already gone; fetch into the local
  branch of the same name when it is not checked out, with Force Fetch; merge and pull into current. → M02
- Create a pull request from a branch (configured in E06-M02). → M02

**Commits, tags, stashes, uncommitted changes**
- Commit: checkout (with Always Accept), cherry pick (Record Origin, No Commit), drop when topologically
  possible, merge, revert, reset current branch to. → M03
- Tag: add lightweight or annotated with a message, push to a remote after adding, a hint of the latest tag,
  collision handling; delete, also on a remote; push to a chosen remote or several; commits and tags can be
  signed (`sign.commits`, `sign.tags`). → M03
- Uncommitted changes: stash, reset to HEAD, clean untracked files, open the working tree in the
  application's substitute for the editor's source control view (a terminal, see E02-M02). → M03
- Stash: apply and pop, both with Reinstate Index; drop; create branch from. → M03

| ID | title | outcome |
| --- | --- | --- |
| E05-M01 | Menus, dialogs and read-only actions | The context-menu and dialog framework, copy and view actions, archives. |
| E05-M02 | Branch actions | Every branch and remote-branch action. |
| E05-M03 | Commit, tag, stash and working-tree actions | The rest of the write actions, and signing. |

### E06 · Repository settings and integrations

- A settings widget on the control bar lists remotes and lets the user add, edit, delete, fetch and prune
  them; fetching a remote shows a dialog with prune and prune-tags options (`dialog.fetchRemote.*`); the
  Fetch from Remote(s) button appears when remotes exist and honours `fetchAndPrune` and
  `fetchAndPruneTags`; branches of individual remotes can be hidden. → M01
- Per repository: a custom name, the branches shown on load (checked out, specific, or inherited from
  `onLoad.*`), include reflog commits, follow first parent only, and overrides of show tags, stashes and
  remote branches. → M01
- User name and email, local and global, are shown and editable; values from files pulled in by config
  `include` directives are read; no global config file is required. → M01
- A button opens the application's settings. → M01
- Issue linking: a regex and a URL with capture-group placeholders, usable globally by default with
  per-repository override, with automatic prefill when a common pattern is found in messages. → M02
- Pull request creation: built-in Bitbucket, GitHub and GitLab providers, custom providers by setting
  (`customPullRequestProviders`), and a Create Pull Request action on branch menus. → M02
- The repository configuration can be exported to a file committed in the repository, which others then use
  automatically. → M03

| ID | title | outcome |
| --- | --- | --- |
| E06-M01 | Remotes and repository settings | The settings widget with remotes, per-repository options and user details. |
| E06-M02 | Issue linking and pull requests | Links in messages, and pull request creation. |
| E06-M03 | Shared configuration | Export and automatic use of a committed configuration file. |

### E07 · Packaging and distribution

Standalone-only: the extension had the Marketplace for this.

| ID | title | outcome |
| --- | --- | --- |
| E07-M01 | Windows build | An installer and a portable build with the application's own icon and version. |
| E07-M02 | Other platforms | macOS and Linux builds, if the owner enables them (owner decision 2). |

### Not reproduced

These items of the inventory are properties of the editor host and have no standalone counterpart. Each has
a substitute named above or is dropped:

- Status bar launch button and command palette entries: the application's menu and shortcuts.
- "View Git Graph" on the source control provider title, and opening to the repository of the active editor
  document: the repository dropdown and recent list.
- Opening the diff or a file in a chosen editor group (`openNewTabEditorGroup`): the application's own
  viewer (E04-M02).
- Retaining the webview context when hidden, the tab icon colour theme, and running inside a web browser or
  Remote Development: not applicable.
- Support for the editor's own `git.path` setting: replaced by the application's git path setting (E02-M02).

## 3 · What every milestone must also satisfy

The inventory above is what the application does. These are properties it must hold while doing it, and they
are not a milestone of their own: **each one is enforced on every slice, by a gate, from the first line of
code.** They are decided in two documents, and this section only says where.

| property | decided in | enforced by |
| --- | --- | --- |
| CPU and memory: the numbers, and the data structures that make them reachable | `docs/ADR-0002-architecture-and-performance.md` §6 | the performance gate, against committed baselines |
| Clean architecture: four rings, dependencies inward only | ADR-0002 §1 | the boundaries gate, mechanically |
| Separation of concerns: no rule in the renderer, none in the adapters | ADR-0002 §1 and §5 | the boundaries gate and code review |
| Clean code, in its checkable part | ADR-0002 §7 | lint, types, the placeholder gate |
| Usual quality gates, plus **mutation testing** | `docs/ADR-0003-quality-gates-and-ci.md` §2 and §3 | fifteen gates behind one `npm run gates` |
| Delivered work does not regress | ADR-0003 §5 | four committed baselines that move in one direction only |
| CI as one expandable line per pull request | ADR-0003 §6 and §7 | a single workflow file, a single required check |

### Gate work deferred past the first milestone

Carried here rather than left in a review file, so it is a planned item with a parent and not a thing someone
remembers. Each is scheduled into the milestone that follows E01-M01 and is not started before it.

| item | why it waits | the measurement it starts from |
| --- | --- | --- |
| **Give `src/ui/` colocated unit tests, and move the two pure suites home.** S05 had to put the renderer's pure tests on the end-to-end runner because the dependency rule had no carve-out for a test file beside the renderer. S06 adds the carve-out; moving the two existing suites is separate work. | The suites work where they are, so nothing is wrong today. What it costs is that they sit outside the unit gate's coverage report and run in the slowest gate instead of the fastest. | Two files, `test/e2e/graph-geometry.spec.ts` and the pure half of `test/e2e/graph-table.spec.ts`, as listed by review round 14. |
| **Taken up as E01-M01-S09, no longer deferred.** Decide the two clocks the mutation gate runs under. The mutation runner's budget is set deliberately; the test runner's inner timeout is the framework's unset default that nobody chose, and it fires first. | Changing either moves every verdict in the report the gate's own clauses are measured against, and that report has to hold still while those clauses are being built. | Detections resting on a clock rather than an assertion were **73, 82, 88 and 100 across four runs of the configured scope on identical source**, against a runner timeout count that sat at 44 to 46 in the same four. The quantity moves with machine load and the single figure of 83 that an earlier draft of this row carried was one draw from that range, not the value. |
| **Taken up as E01-M01-S12, no longer deferred.** Run the unit suite with `isolate: false` under the mutation gate. S09 measured it and did not take it. | It shares one module registry across every test file, so it changes what a test sees; taking it needs evidence that no file depends on another's module state. | S09's measurement, recorded in its slice document: seven concurrent copies of the gate's command in 5.7 s with it against 25–30 s without, about four times the throughput, which would take `gates:mutation` from about an hour to about a quarter of one. |

### Raised during E01-M01, placement open for the owner

Recorded so none of these is lost. None is scheduled: each either changes the frozen contract, needs the
reference extension observed, or is new product scope, and placing it is the owner's decision
(`AGENTS.md` §2).

- **Read a page at an offset.** `RepositoryReader.readPage` takes no offset, so the *n*th Load More re-reads
  *n + 1* pages (S06). S06's slice document tables four runs of five presses on the 10 000-commit fixture,
  2026-09-19: the fifth press, reading three times the commits of the first, took 420 to 652 ms against 451 to
  551 ms, so no growth was measurable at that size.
- **A `FailureKind` for a defect of the application itself.** Today such a failure is reported as a git
  failure. Adding one changes the frozen contract (S06, review rounds 15 and 16).
- **What Refresh keeps in place.** Refresh keeps the scroll offset in pixels, not the commit at the top
  (FIX-17). Which of the two is right needs the reference extension observed.
- **Open a bare repository.** `git status` refuses to run in one, so opening one fails with git's own words;
  `WorkingTree` cannot say "there is no working tree", and adding that changes the frozen contract (S03).
- **A test for one Open overtaking another.** The guard exists (FIX-14) and is correct by reading; driving
  the ordering reliably needs a fixture whose `git status` is slow (review round 16).

### What shapes the plan rather than the code

- **`MILESTONE.md` lists the full gate set for every milestone**, so the reviewer runs the same gates at
  every wave and before every promotion (`AGENTS.md` §7).
- **The first two slices of the first milestone build this ground and nothing else.** Retrofitting a
  dependency rule, a columnar store or a mutation threshold onto code that already exists costs several
  times what it costs to start with them.

## 4 · The MVP cut

The smallest set already worth opening on a real repository: see its graph with every branch and ref, choose
which branches, and read any commit's details and changed files.

| order | milestone | tag on promotion |
| --- | --- | --- |
| 1 | E01-M01 First graph | v0.1.0 |
| 2 | E03-M01 Branches dropdown | v0.2.0 |
| 3 | E04-M01 Commit Details View | v0.3.0 |

Everything else waits for the owner's review of the MVP and of the handoff pattern (`docs/KICKOFF.md` §9).
The MVP includes no write action on the repository: the first version a stranger runs cannot damage their
work.

## 5 · Order of the rest, proposed

After the MVP, epics interleave so that each milestone is worth using on its own: E01-M02, E05-M01, E04-M02,
E02-M01, E01-M03, E05-M02, E06-M01, E03-M02, E04-M03, E05-M03, E02-M02, E01-M04, E04-M05, E06-M02,
E04-M04, E02-M03, E06-M03, E07-M01, E07-M02. Each of these needs the owner's approval before its first
task file (`AGENTS.md` §2), and its slices are written then.

## 6 · The promotion standard

`AGENTS.md` §8 is **confirmed** as it stands: one whole milestone per promotion, an annotated tag
`v0.<minor>.<patch>`, minor bumped per milestone and patch only for an all-fix sequence. Nothing in this plan
needs a smaller unit.

## 7 · Owner decisions that are live now

1. **Target platforms.** Default recorded in ADR-0001: cross-platform code, built and verified on Windows
   only until E07-M02.
2. **The behavioural reference.** Version 1.30.0 is the last release, and it is installed on the development
   machine. Default: 1.30.0, observed there.
3. **The extension's wiki.** The Marketplace page links to a wiki for setting defaults and for the
   context-menu visibility and pull-request provider formats. `AGENTS.md` §1 does not list it. Default:
   stay Marketplace-only and learn those by observation; if the owner allows the wiki, §1 is amended.
4. **Sequence files** committed or ignored becomes live at the first task file. Default: ignored
   (`AGENTS.md` §4).
5. **The shell, under the lightweight requirement.** `docs/ADR-0001-stack.md` Axis 6 answers it with
   numbers: on Windows both candidates render in Chromium, so the difference is a fixed 60 to 100 MB at
   rest and about 150 MB on disk, not something that grows with the repository. Default: **Electron**, with
   the footprint met by ADR-0002's budgets and a written reversal trigger. Choosing Tauri instead is
   cheapest now, before any code exists, and costs two machine-level installs before the first gate can run.
6. **Branch protection.** Making the workflow's `gate` job a required check is a change to the hosted
   repository's settings, which only the owner may authorise (`AGENTS.md` §2). Without it the workflow still
   runs and still reports; it is simply not binding. Default: the workflow ships, and the setting waits for
   the owner.

Decision 4 of `docs/KICKOFF.md` §10, the name, is not live.
