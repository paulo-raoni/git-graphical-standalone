import { nativeTheme } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ThemeChoice } from '../contracts/index';

/**
 * The colour scheme a person chose, applied to the whole application and kept
 * across restarts.
 *
 * **Applied through `nativeTheme.themeSource`**, the one setting Electron gives
 * the main process over the scheme, and not by the renderer alone. Setting it
 * moves three things a stylesheet cannot reach: the `prefers-color-scheme` the
 * page sees, the window's frame and its menu bar. Measured on Windows 11 on
 * 2026-10-23 with the built application, by reading the frame's
 * `DWMWA_USE_IMMERSIVE_DARK_MODE` through `DwmGetWindowAttribute` after each
 * assignment: `dark` read 1, `light` read 0, and `system` read 1 on that machine,
 * whose operating system prefers dark; a capture of the window through
 * `desktopCapturer` showed the menu bar dark or light with it. A choice applied
 * only by the page would have left both following the operating system.
 *
 * **Kept in a file under the application's user-data directory**, written by
 * this process, rather than in the renderer's own storage, because the scheme
 * has to be known here **before the window exists**: `src/app/main.ts` reads it
 * and assigns `themeSource` before it creates the window, which is what makes
 * the stored choice the one Chromium resolves the first paint with. Storage only
 * the page can read is read too late for that.
 *
 * The file is read once, synchronously, before the window is created and before
 * anything else is waiting on this process; it is a few bytes. It is written
 * asynchronously, after the choice has already been applied, so a slow disk
 * never delays the change on screen.
 */

/**
 * The file the choice is kept in, inside the user-data directory: the choice's
 * own word and nothing else, so there is no format to parse and nothing a
 * reader can half-understand.
 */
const THEME_FILE = 'theme';

/** Every value a person can choose, for checking what arrives from the page or the disk. */
const CHOICES: readonly unknown[] = Object.values(ThemeChoice);

/**
 * Whether `value` is one of the three choices, and nothing else. `includes`
 * compares with `SameValueZero`, so anything that is not one of the three
 * strings — another type included — is refused without a separate check.
 */
function isThemeChoice(value: unknown): value is ThemeChoice {
  return CHOICES.includes(value);
}

/** The scheme in force, and the way to change it. */
export interface ThemeStore {
  /** The choice in force: the stored one, or `system` when there is none. */
  readonly current: () => ThemeChoice;
  /**
   * Apply `requested` when it is one of the three choices, and answer the choice
   * in force once it has been written for the next start. Anything else changes
   * nothing, because it arrived from the page and the page is not trusted.
   */
  readonly choose: (requested: unknown) => Promise<ThemeChoice>;
}

/**
 * The stored choice, or `system` when the file is missing, unreadable or holds
 * anything other than one of the three choices.
 *
 * A file this application did not write, or wrote and then lost half of, is
 * treated as no choice at all: falling back to the operating system's preference
 * is the state of a first start, and nothing a person did is lost by it that a
 * second choice would not restore.
 */
function readStoredChoice(file: string): ThemeChoice {
  try {
    const stored = readFileSync(file, 'utf8');
    return isThemeChoice(stored) ? stored : ThemeChoice.System;
  } catch {
    return ThemeChoice.System;
  }
}

/**
 * Read the stored choice, apply it, and answer the store.
 *
 * **Call it before the first window is created.** The assignment to
 * `themeSource` here is the line the start of the application hinges on: made
 * after the window exists, the first paint is resolved against the operating
 * system's preference and the stored scheme arrives a frame later.
 *
 * @param directory the application's user-data directory
 */
export function openThemeStore(directory: string): ThemeStore {
  const file = join(directory, THEME_FILE);
  let choice = readStoredChoice(file);
  nativeTheme.themeSource = choice;
  // Writes are chained, so two choices made in quick succession reach the disk
  // in the order they were made and the file ends holding the last one.
  let saved: Promise<void> = Promise.resolve();

  return {
    current: (): ThemeChoice => choice,
    choose: async (requested: unknown): Promise<ThemeChoice> => {
      if (!isThemeChoice(requested)) {
        return choice;
      }
      choice = requested;
      nativeTheme.themeSource = requested;
      saved = saved
        .then(() => writeFile(file, requested))
        .catch((error: unknown) => {
          // The scheme is applied for this session whatever happens here; what
          // is lost is only that the next start will not remember it. The
          // window's one place for a failure replaces the graph, which is out of
          // proportion to that, so it is said on the process's own error
          // stream, where a person who started the application from a terminal
          // sees it.
          process.stderr.write(`The theme could not be kept: ${String(error)}\n`);
        });
      await saved;
      return requested;
    },
  };
}
