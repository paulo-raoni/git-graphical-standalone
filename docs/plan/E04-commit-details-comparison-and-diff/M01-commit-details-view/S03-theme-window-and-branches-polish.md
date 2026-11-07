# E04-M01-S03 · Theme, window and branches polish

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S03 theme, window and
branches polish

Four things a person meets, carried from E03-M01's reviews, and one sentence about the order of the branch list.
None of them is behaviour of Git Graph: they are this application's own.

## A choice that cannot be kept is said in the window

When the theme choice (`src/app/theme.ts`) or a repository's kept branch selection (`src/app/selections.ts`)
cannot be written, the choice still applies until the application closes, and only the next start loses it.
Until this slice that was said only on the main process's standard error, which a person who did not start the
application from a terminal never sees.

- **What a person sees.** A warning message box attached to the window, titled *Not kept*, saying "The theme
  choice could not be kept." or "The branch selection could not be kept.", then that it still applies until the
  application closes but the next start will not have it, and the path of the file that could not be written.
  It has one button, OK. The standard error line stays as it was.
- **Once per kind per run.** A disk that refuses one write refuses the next, so a box at every choice would make
  the rest of the run a series of boxes. `sayUnkept` in `src/app/window.ts` keeps the kinds it has said in a set
  that lives as long as the main process; the line the "once" hinges on is its `unkeptSaid.has(what)` check.
- **Where it is said from.** Both stores call `sayUnkept` from the `catch` of their chained write, after the
  standard error line: for the selection that is after the rename has been tried its ten times
  (`RENAME_ATTEMPTS`), or at once when the folder cannot be made. The box is attached to the focused window, or
  the first window when none has the focus, and is shown without a parent only when there is no window.
- **Why a message box and not the window's failure view.** The failure view replaces the graph, which is out of
  proportion to a choice that still applies; this is the orchestrator's choice of 2026-11-02, open to the owner's
  overruling, as `MILESTONE.md` records it under *The orchestrator's choices, for the owner to overrule* (that
  paragraph gives no date; the date is the one this slice's task gave). *Corrected by E04-M01-FIX-02, 2026-11-06:*
  this sentence called it the owner's ruling. The box is not awaited: nothing waits on its answer.
- **What it costs.** Nothing on start and nothing on a write that succeeds: `sayUnkept` runs only from the
  failure path, and the only work added elsewhere is the import of `dialog`, a property read when it is called.
  The production `main.cjs` measured 7111 bytes with `npm run gates:size` on 2026-11-03 at this lane's head; the
  size at Base was not measured by this lane.

**Seen in the running application** on 2026-11-03, with the built application started by a script on a
user-data directory of its own holding a directory named `theme`, and Dark then Light chosen: after the first
choice the application's window owned one visible window of class `#32770` titled *Not kept* with an OK button,
and the application's window was disabled while it was open (`EnumWindows`, `GetWindow(GW_OWNER)` and
`IsWindowEnabled`); after the second choice there was still exactly one, and standard error held both lines.

## The window's own background, held by a check

`src/app/window.ts` gives the window the background of the scheme in force and moves it on every `updated`
event of `nativeTheme`. E03-M01's review round 01 removed that move and every case stayed green. The case *the
window's own background follows Light, Dark and System* in `test/e2e/theme.spec.ts` reads the window's own
colour from the main process (`getBackgroundColor`), not the page's, after each choice, and requires `#FFFFFF`
under Light, `#1F1F1F` under Dark, and under System whichever of the two the operating system prefers. It starts
on System, so whichever scheme the machine prefers, one of Light and Dark has to move the colour.

## The title bar and the window's background, observed

Run on 2026-11-03 on Windows 11 (whose preference on this machine is dark), with the built application on a fresh
user-data directory, at a display scale of 1, each choice made in the Theme control.

| choice | title bar | window's background | `DWMWA_USE_IMMERSIVE_DARK_MODE` |
| --- | --- | --- | --- |
| Light | `#F9F1ED` | `#FFFFFF` | 0 |
| Dark | `#251E1B` | `#1F1F1F` | 1 |
| System | `#251E1B` | `#1F1F1F` | 1 |

**How, and what it is not.** The screen itself could not be read in that session: `Graphics.CopyFromScreen`
failed with an invalid handle and Electron's `desktopCapturer` returned empty images for both screens, while the
lock screen's process (`LogonUI`) was running; that the desktop was locked is an inference. So the colours were
read from the window rendered by `PrintWindow` with `PW_RENDERFULLCONTENT`, frame included, down the middle column
of its 1280 by 800 pixels: the title bar is rows 0 to 30. The window's background is the client area with the
document's root element set to `display: none`, so that no page paints over it; there it was one colour from the
top of the client area to its bottom border. The title bar's two colours are not neutral greys, which suggests a
tint the system adds to the frame (an inference). *Corrected by E04-M01-FIX-02, 2026-11-06:* from the screen
(below) the Light title bar is `#F3F3F3`, a neutral grey, so that sentence holds for Dark only.
`DWMWA_USE_IMMERSIVE_DARK_MODE` was read with `DwmGetWindowAttribute` after each choice. Electron's
`desktopCapturer` window source, which did work, captures the client area only, so it showed no title bar. No
screenshot is committed.

**From the screen, measured by E04-M01's review round 01**, not by this slice, and not reproduced by
E04-M01-FIX-02, which records it here: on 2026-11-04 between 22:58 and 22:59, Windows 11 preferring dark, display
scale 1, the built application at `4a6a949` on a fresh user-data directory, its window brought to the front and
focused. `Graphics.CopyFromScreen` read one pixel row 12 px below the window's top edge, across the middle 30 % of
its width (384 pixels), and one row across the middle of the client area with the document's root at
`display: none`.

| choice | title bar (the three most frequent colours, of 384 pixels) | window's background (of 384 pixels) |
| --- | --- | --- |
| Light | `#F3F3F3` 384 | `#FFFFFF` 384 |
| Dark | `#251E1B` 135, `#261E1A` 134, `#251E1C` 95 | `#1F1F1F` 384 |
| System | the same as Dark | `#1F1F1F` 384 |

So the Light title bar on the screen is `#F3F3F3` where `PrintWindow` read `#F9F1ED`. Under Dark and System the
screen's most frequent title-bar colour is the `#251E1B` `PrintWindow` read, beside two within one step of it in
each channel, and every window's background is the one in the table above.

**Owed to the owner:** a live change of the operating system's preference with System chosen, which needs a change
to the system's settings that this slice does not make. *Corrected by E04-M01-FIX-02, 2026-11-06:* the colours as
sampled from the screen were also listed here as owed; review round 01 has sampled them, above.

## The order of the branch list, said truly

`branchEntries` in `src/contracts/branch-menu.ts` sorts names in code-unit order, the default order of
JavaScript's `sort`. Its comment and the S10 slice document said that is also the order git lists references in;
E03-M01's review round 05 found it contradicted. Measured by this slice on 2026-11-03 with git 2.51.0 on Windows
(the `files` reference storage): thirteen branches under `refs/heads/x/`, named `Z`, `a`, `b`, and `a` followed by
U+00E9, U+0100, U+4E00, U+D7FF, U+E000, U+FF21, U+FFFD, U+10000, U+1F600 and U+20000, listed by
`git for-each-ref` and by `git branch --list`, with the references loose and again after `git pack-refs --all`.
All four listings were in code-point order and equal to each other; JavaScript's `sort` put the three names above
U+FFFF ahead of the three from U+E000 to U+FFFF, and agreed with git on every other pair. The comment and the S10
document now say exactly that. The code is not changed.

## The check mark is out of the row's name

The mark of a checked row is drawn by `.branches__option[aria-selected='true']::before` in
`src/ui/renderer.css`, and generated content is part of an element's accessible name, so a checked row was named
"✓ main" and a screen reader read the check twice, the second time from `aria-selected`. The rule now gives the
generated content an empty alternative text, `content: '✓ ' / ''`: the mark is drawn as before and contributes
nothing to the name. Chosen over a decorative element because it changes one declaration and no markup; it cost
the stylesheet 5 bytes, which now measures 6112 of its 6144.

Read on 2026-11-03 in the running application through Chromium's own accessibility tree
(`Accessibility.getFullAXTree` over the DevTools protocol), with `feature` checked: the options were named
"Show All", "main", "feature", "release", "topic", "origin/HEAD", "origin/feature", "origin/main" and
"origin/only-remote", `feature` alone selected, and the checked row's `::before` computed `"✓ " / ""`. The end-to-end
cases find a checked row by its exact name and selected state, and read that its mark is still drawn.

## Show Remote Branches before the first page

Before a repository's first page the checkbox showed checked and disabled, whatever was kept, for as long as the
first page took (E03-M01's review round 07 measured 14 to 703 ms on a restart). `buildParts` in
`src/ui/branch-control.ts` now makes it indeterminate as well as disabled, and `open` in `src/ui/renderer.ts`
clears that in the same task that sets what the open's reply says is kept, before the control is enabled; the line
the state before the first page hinges on is `remotes.indeterminate = true` in `buildParts`. An open that fails
leaves it indeterminate and disabled, since no repository is shown.

Seen on 2026-11-03 with the built application restarted twice on a repository kept with remote branches hidden, by
a script recording the checkbox's state every frame from the document's start: indeterminate, unchecked and
disabled from 234 and 264 ms, then unchecked and enabled from 7239 and 4871 ms, with nothing between (the machine
was saturated by other projects' runs, which is why the first page took seconds). The end-to-end case holds the
state where it lasts: a window started on no repository, which stays before its first page. The state after the
first page is held by the cases that read the checkbox there, each requiring its accessibility snapshot to say
checked or unchecked as kept, where an indeterminate box says `mixed` (`toBeChecked` reads only `checked`): with
`shell.branches.remotes.indeterminate = false;` removed from `open`, two cases of `test/e2e/branches-dropdown.spec.ts`
and five of `test/e2e/selection-kept.spec.ts` went red (E04-M01-FIX-01, 2026-11-06), where review round 01 had
measured all 13 cases of the two files green without that line.
