# E03-M01-S01 · Theme selector

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S01 theme selector

## What the control does

The bar ends with a list labelled **Theme** holding exactly three choices, **Light**, **Dark** and **System**,
in that order, with the one in force shown. Its accessible name is *Theme*, from a visible `label` element that
names it, and it is a native `select`, so it is reached with Tab and changed with the arrow keys like any other
list. It is disabled for the moment between the window appearing and the main process saying which scheme is
in force, so it never shows a choice that is not the one applied.

- **System**, the choice of a first start, follows the operating system's light or dark preference, including
  when the preference changes while the window is open.
- **Light** and **Dark** pin one scheme whatever the operating system prefers.
- A choice applies to the whole window at once: no reload, no change to the scroll offset, to what is loaded
  or to the graph canvas. It belongs to the application and not to a repository, so opening another
  repository keeps it, and it is still in force the next time the application starts.

The colours are the ones `src/ui/renderer.css` had before this slice; no colour was added or changed.

## How a choice is applied: in the page and in the main process, both

A choice is applied twice, by two mechanisms that agree.

1. **The page pins it itself.** `src/ui/shell.ts` writes the choice to `data-theme` on the root element, in
   the task of the list's `change` event. `renderer.css` writes every colour once, as `light-dark(light,
   dark)`, and picks the half with the `color-scheme` property: `light dark` on the root, which follows the
   preference the page sees, and `light` or `dark` under `[data-theme='light']` and `[data-theme='dark']`.
   The same property is what Chromium draws the scrollbars and the native controls by, so they and the colours
   cannot disagree.
2. **The main process sets `nativeTheme.themeSource`** (`src/app/theme.ts`), over a new channel. That one
   setting moves three things a stylesheet cannot reach: the preference the page sees, the window's frame and
   its menu bar.

Why both. Measured on Windows 11, whose preference on this machine is dark, on 2026-10-23, with the built
application, by assigning `themeSource` from the main process and reading the frame's
`DWMWA_USE_IMMERSIVE_DARK_MODE` with `DwmGetWindowAttribute` after each assignment: `dark` read 1, `light`
read 0, `system` read 1; a capture of the window through Electron's `desktopCapturer` showed the menu bar
dark or light with it. So a choice applied by the page alone leaves the frame and the menu bar on the
operating system's preference: on this machine, Light would have shown a light page under a dark frame.
And a choice applied by `themeSource` alone cannot be shown against an emulated preference, because the
emulation of `prefers-color-scheme` the end-to-end suites run under sits above it, so the end-to-end
spec could not hold Dark against a light preference. With both, the page's colours are a function of the
choice in either situation, and in the running application the two say the same thing.

The window's own background colour, painted where the document has not painted yet, follows the scheme too:
`src/app/window.ts` creates the window with `--surface` of the scheme in force and sets it again on every
`nativeTheme` `updated` event, which a choice and an operating-system change both raise.

## Where the choice is kept, and why there

In a file named `theme` in the application's user-data directory, holding the choice's own word and nothing
else, written by the main process. Not in the renderer's own storage, because the scheme has to be known
**before the window exists**: `src/app/main.ts` calls `openThemeStore` before it creates the window, and
`openThemeStore` reads the file and assigns `nativeTheme.themeSource` there. **That assignment is the line
the start hinges on**: it is what makes the stored choice the preference Chromium resolves the document's
first paint with. Storage only the page can read is read after the page has started, which is too late for
that.

The file is read once, synchronously, before the window exists and before anything is waiting on the main
process; it is a few bytes. It is written asynchronously after the choice is already applied, and writes are
chained so that two quick choices reach the disk in the order they were made. A missing, unreadable or
foreign file is read as no choice, which is System. A write that fails leaves the choice applied for the
session and is reported on the main process's error stream: the window's only place for a failure replaces
the graph, which is out of proportion to a setting that will not be remembered.

## Interfaces

Two channels, recorded in `test/contract/shapes.snapshot.txt`:

| channel | bridge method | request | reply |
| --- | --- | --- | --- |
| `theme:choice` | `themeChoice()` | none | `Result<ThemeSetting>` |
| `theme:choose` | `chooseTheme(request)` | `ChooseThemeRequest { choice }` | `Result<ThemeSetting>` |

`ThemeChoice` is `'light' | 'dark' | 'system'`, exported as a frozen value with the same name, and
`ThemeSetting` is `{ choice: ThemeChoice }`. `theme:choose` answers once the choice has been written; a value
outside `ThemeChoice`, which can only come from a page that is not this one, changes nothing and is answered
with the choice in force. The renderer does not show that reply, because a person may have chosen again by
the time it arrives and the list already shows what they chose last.

## What the graph canvas does on a change: nothing

Nothing the canvas paints depends on the scheme, so it installs no listener for one and does not repaint when
it changes, as E01-M01-S05 decided under *One palette, not one per theme*. Established two ways. By reading
`src/ui/graph-canvas.ts`: its only colours are `strokeStyle` and `fillStyle`, both set from `laneColour`,
which is the scheme-free palette of `src/ui/palette.ts`, and it clears to transparency with `clearRect`
rather than filling with the surface colour; the ring around HEAD's dot is stroked in the lane's colour. By
measurement, in the end-to-end spec: the canvas's pixels read back byte for byte equal before and after
switching to Dark at the same scroll offset, and the light golden image of `golden-graph.spec.ts` matches
the canvas drawn with the window in Dark. So there is no dark golden image.

## What the spec holds

`test/e2e/theme.spec.ts`, five cases against the built application, each on a user-data directory of its
own (`--user-data-dir`), so no choice is left behind for another suite or for the person running it:

1. **System is the first start and follows the preference both ways**: the list shows System, the page is
   light under an emulated light preference and dark under an emulated dark one.
2. **Dark and Light override the preference at once**: with the ten-thousand-commit fixture open and scrolled
   to 3 600 pixels, Dark under a light preference and Light under a dark one are in the page's computed
   styles straight after the selection, `themeSource` follows, the scroller's `color-scheme` follows, and
   the document (no second navigation entry, a mark left on the window still there), the scroll offset, the
   loaded rows and the canvas's pixels are all unchanged.
3. **The choice survives a relaunch and is the scheme of the first paint**: with the emulation off, the case
   chooses the scheme the operating system does **not** prefer, so that the relaunch cannot pass by the
   operating system's preference showing through; relaunched, an init script records that the document
   started with that preference, and that the first animation frame — which runs before the first paint, with
   no paint recorded yet — already had the chosen surface colour.
4. **The control by keyboard alone**: Tab reaches it, found by its role and its accessible name, and the
   arrow keys move it through Dark, Light and back to System, each applied.
5. **The light golden image holds with the window in Dark.**

Watched failing, in this lane on 2026-10-23, against the built application each time:

- With the source at `Base`, which has no control, all five fail.
- With the assignment of `themeSource` in `openThemeStore` taken out — the line the start hinges on — case 3
  fails and the other four pass: only the relaunch depends on it, and it notices.
- With `data-theme` no longer written, all five fail.
- With the assignment of `themeSource` on a choice taken out, cases 2, 3 and 5 fail, the three that read the
  main process's half after a choice; 1 and 4 pass, because neither reads the main process after a choice.
