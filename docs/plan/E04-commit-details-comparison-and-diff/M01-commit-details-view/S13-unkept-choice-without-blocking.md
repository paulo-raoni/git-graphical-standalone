# E04-M01-S13 · Unkept choice said without blocking

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S13 unkept choice said
without blocking

When the theme choice or a repository's kept branch selection cannot be written, the application says so in a notice
inside its own window. E04-M01-S03 said it in a message box. That box was modal, and on 2026-11-04 it blocked the
owner's screen during a test run until they dismissed it (the owner's report in `MILESTONE.md`). None of this is
behaviour of Git Graph: it is this application's own message.

## What a person sees

A strip under the bar, in the window's own flow, that stays until its Close control is used. It says, in one
sentence each, what could not be kept, that it still applies until the application closes but the next start will not
have it, and the path of the file that could not be written:

> The theme choice could not be kept. It still applies until the application closes, but the next start will not
> have it. This file could not be written: `<path>`

The branch selection's notice says "The branch selection could not be kept." and names its record under
`branch-selections`. Standard error keeps its line, as before.

- **It blocks nothing.** The strip sits between the bar and the stage in the window's column (`.notices` in
  `src/ui/renderer.css`, `flex: none`), so a notice shortens the stage instead of covering it. The end-to-end cases
  read the strip's box ending at or above the graph's, and press Load More Commits with a real click while the notice
  is open, which Playwright makes only on an element that receives the pointer there.
- **It takes no focus.** It is added to a `status` live region built with the shell and kept, empty, when no notice is
  open. Its announcement by a screen reader was not measured; Playwright's aria snapshot of the page reads the strip
  as `status` holding the sentence as a `paragraph` and a `button "Close"` (read with Playwright's `ariaSnapshot` on
  2026-11-07). The theme case chooses from the keyboard and reads the Theme control still focused once the notice is
  shown.
- **Close is a button**, placed after the bar's last control in the tab order: the cases focus the Theme control,
  press Tab once, read Close focused, and press Enter, after which the strip is empty.
- **Once per kind per run.** `sayUnkept` in `src/app/window.ts` still keeps the kinds it has said; the line "once"
  hinges on is its `unkeptSaid.has(what) || window === undefined` check. Two notices can be open at once only when both
  kinds have failed.

## How it reaches the window

`CHANNELS.unkeptChoice` (`application:unkept-choice`) in `src/contracts/ipc.ts` is the one message the main process
sends unasked. Its payload is `UnkeptChoice`, two strings: `what` (`theme choice` or `branch selection`) and `file`
(the absolute path). The bridge gains one method of the same name, `unkeptChoice(listener)`, which subscribes; the
bridge's global name and every other channel are unchanged.

- **Sent** by `sayUnkept` with `webContents.send` to the focused window, or the first window when none has the focus.
  No `dialog` method is called any more.
- **Checked on arrival** by the preload, with `unkeptChoiceOf` (`src/contracts/unkept-choice.ts`): anything but a value
  whose `what` and `file` are strings is dropped, and the page is handed a new object of those two fields, never the
  IPC event, whose `sender` is the preload's `ipcRenderer`. The preload bundle now carries that module.
- **Shown** by `showUnkept` of `src/ui/shell.ts`, wired once in `connect` of `src/ui/renderer.ts`.
- **With no window to send to**, it is said on standard error alone and the kind is not counted as said. Measured on
  2026-11-07 with the built application on a profile of its own holding a directory named `theme`, with
  `BrowserWindow.getAllWindows` and `getFocusedWindow` replaced in the main process to answer no window: choosing Dark
  wrote the standard-error line once, the window held no notice after a request to the main process had been answered,
  no message box was asked for, and Dark still applied.
- **Inference, not measured:** a message sent while the window's document is being replaced (a reload) reaches no
  subscriber, and that kind is then counted as said.

## Seen in the running application

On 2026-11-07, Windows 11, the built application at this lane's code, started by a script on a fresh user-data
directory holding a directory named `theme`, the page's preference emulated light. Screenshots went to a scratch
folder and are not committed.

| choice | strip background | text | strip's bottom border | contrast of text on strip |
| --- | --- | --- | --- | --- |
| Light | `rgb(255, 244, 206)` | `rgb(31, 31, 31)` | `rgb(226, 226, 226)` | 14.98 : 1 |
| Dark | `rgb(61, 52, 24)` | `rgb(232, 232, 232)` | `rgb(51, 51, 51)` | 10.07 : 1 |

The colours are computed styles read in the page; the ratios are WCAG's formula over them. Under Light the notice was
seen above the empty window: the script chose Light before the repository's first page was shown. Under Dark it was seen above a repository's graph at 1280 by 800, and
again at the window's minimum, 720 by 420: there the sentence wrapped to three lines, the strip measured 70 px from
y 42 to 112, and the graph's scroller began at y 112, so no row was under it. In both schemes the Close control is drawn
as the bar's buttons are. Standard error held two lines after Light then Dark, the window one notice, and no message box
was asked for.

## The cases

`test/e2e/unkept-notice.spec.ts`, collected by the `application` project, holds both kinds. Each case puts something
in the profile where the file goes (a directory named `theme`, or a file named `branch-selections`) before the launch,
through a `prepare` step `withOwnProfile` now takes; makes the choice through the window's own control; reads the
notice by its role and text; uses Load More Commits with the notice open; makes a second choice that fails too and
counts one notice after a request to the main process has been answered; and closes the notice from the keyboard.
`withOwnProfile` records every message box the main process asks for and fails the case on one. S03's two message-box
cases are removed from `theme.spec.ts` and `selection-kept.spec.ts`.

The count after a request answered relies on the messages the main process sends one window arriving in the order
they were sent. That was measured by the probe that sends a second notice of a kind: in ten runs of the two cases
(`--repeat-each=5`) each read two notices.

## A profile removed only after the application has exited

`theme.spec.ts` (`afterEach`) and `selection-kept.spec.ts` (`afterAll`) launch for themselves, and removed their
profiles without waiting. They now keep every application process they launch and wait for each with `ended`, the wait
`withOwnProfile` uses (exported from `test/e2e/support/fixtures.ts`), before removing a profile through
`removeDirectory`, which retries.

Measured on 2026-11-07 with a case added to `theme.spec.ts` for the measurement and then removed, which launches the
application and never returns, run out at a 15 s limit: in every run the main process was still running when the hook
began. Without the wait, the removal ran while it was still running and met `EPERM`. With the wait, the main process
had exited before every removal. That is the property this holds: the process that writes the choices into a profile
is gone before the profile is. It does not hold that the removal then succeeds: after a main process stopped by force
(a case that ran out is never closed), the application's other processes still named the profile on their command line,
and the removal met `EPERM` in most runs, for over thirty seconds in some, while another lane's mutation run held the
machine at 100 % load. The audit carries each run.
