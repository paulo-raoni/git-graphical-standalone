import { ThemeChoice } from '../contracts/index';
import type { Failure, UnkeptChoice } from '../contracts/index';

import { mountBranchControl } from './branch-control';
import type { BranchControl } from './branch-control';
import { failureHeadline, repositoryLabel } from './status-text';

/**
 * Everything in the window that is not the table: the control bar, the place the
 * table is mounted, and the view shown when something went wrong.
 *
 * It is deliberately a separate module from `./graph-table`, which
 * `mountGraphTable` owns from the root down — it calls `replaceChildren` on what
 * it is given — so the shell hands it a stage of its own rather than sharing an
 * element with it.
 *
 * Nothing here decides anything. It holds no bridge and no state beyond which of
 * its two panes is showing, which colour scheme it was told to show and which
 * notices are open, which is why the whole of the wiring is in `./renderer.ts`
 * and the wording of everything but the controls and the notice of a choice not
 * kept is in `./status-text.ts`. The Branches dropdown is built by
 * `./branch-control.ts` and only placed in the bar here.
 *
 * Everything is built from elements and `textContent`, never from a markup
 * string, so a repository path and a message from git cannot be interpreted as
 * markup — the same rule `./row-element.ts` follows for a commit subject.
 */

/**
 * What the two controls say when they are resting. Exported because
 * `./renderer.ts` puts them back after a request, and a label read off the
 * element there would be whatever the element happened to show.
 */
export const OPEN_LABEL = 'Open Repository';
export const REFRESH_LABEL = 'Refresh';

/**
 * The colour-scheme control's name, and what each of its three choices says,
 * in the order the list shows them.
 */
const THEME_LABEL = 'Theme';
const THEME_CHOICES: readonly (readonly [ThemeChoice, string])[] = [
  [ThemeChoice.Light, 'Light'],
  [ThemeChoice.Dark, 'Dark'],
  [ThemeChoice.System, 'System'],
];

/** The `id` the theme control's visible label names it by. */
const THEME_ID = 'bar-theme';

/** What the control that closes a notice says. */
const CLOSE_LABEL = 'Close';

/** What the shell hands `./renderer.ts` to drive it with. */
export interface Shell {
  /** The element `mountGraphTable` owns. */
  readonly stage: HTMLElement;
  /** The control that asks for a folder chooser. */
  readonly open: HTMLButtonElement;
  /** The control that re-reads the open repository. */
  readonly refresh: HTMLButtonElement;
  /** The Branches dropdown and the Show Remote Branches checkbox. */
  readonly branches: BranchControl;
  /**
   * The control that chooses the colour scheme. Disabled until
   * {@link Shell.showTheme} has been told which one is in force, so that it never
   * shows a choice that is not the one applied.
   */
  readonly theme: HTMLSelectElement;
  /**
   * Show `choice` in the control and apply it to the whole document at once:
   * `data-theme` on the root element is what `renderer.css` pins a scheme by.
   */
  readonly showTheme: (choice: ThemeChoice) => void;
  /** Show which repository the window is looking at, or that there is none. */
  readonly showPath: (path: string | null) => void;
  /** Replace the table with the failure, in git's own words. */
  readonly showFailure: (failure: Failure) => void;
  /** Put the table back. */
  readonly clearFailure: () => void;
  /**
   * Say that a choice could not be kept for the next start, in a notice under the
   * bar that stays until its Close control is used.
   */
  readonly showUnkept: (unkept: UnkeptChoice) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function control(className: string, label: string): HTMLButtonElement {
  const button = element('button', className);
  button.type = 'button';
  button.textContent = label;
  return button;
}

/**
 * The colour-scheme control: a list of exactly three choices with a visible
 * label that names it, so it has an accessible name and is reached and changed
 * from the keyboard as every native list is.
 */
function themeControl(): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = element('label', 'bar__theme-label');
  label.htmlFor = THEME_ID;
  label.textContent = THEME_LABEL;
  const select = element('select', 'bar__theme');
  select.id = THEME_ID;
  for (const [value, text] of THEME_CHOICES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.disabled = true;
  return { label, select };
}

/**
 * One notice of a choice not kept: the three things a person needs, in plain
 * words (what was not kept, that it still applies until the application closes,
 * and the file that could not be written), and a Close control, a button, so the
 * keyboard reaches it as it reaches the bar's.
 */
function unkeptNotice({ what, file }: UnkeptChoice): HTMLElement {
  const notice = element('div', 'notice');
  const text = element('p', 'notice__text');
  text.textContent =
    `The ${what} could not be kept. It still applies until the application closes, ` +
    `but the next start will not have it. This file could not be written: ${file}`;
  const close = control('bar__button', CLOSE_LABEL);
  close.addEventListener('click', () => {
    notice.remove();
  });
  notice.append(text, close);
  return notice;
}

/**
 * Build the shell into `root` and answer the handles the wiring needs.
 *
 * The failure view is built now rather than when a failure arrives, for the
 * reason `./graph-table.ts` builds both of its states up front: creating
 * elements on the path between an event and the frame that shows it is work
 * inside the budget of `docs/ADR-0002-architecture-and-performance.md`
 * decision 6.
 *
 * git's message goes into a `pre`, because git writes more than one line —
 * `discoverGit`'s refusal lists every place it looked — and a message folded
 * onto one line is a message nobody reads to the end.
 *
 * The notices sit in a strip between the bar and the stage, in the flow of the
 * column, so a notice shortens the stage rather than covering any of it. The
 * strip is a `status` live region built now and kept, empty when no notice is
 * open, because live regions announce what is added to a region already in the
 * page, politely and without moving the focus; a region added with its text
 * already in it is not reliably announced (WAI-ARIA's guidance on live regions,
 * not measured here with a screen reader).
 */
export function mountShell(root: HTMLElement): Shell {
  const bar = element('header', 'bar');
  const path = element('span', 'bar__path');
  const open = control('bar__button bar__open', OPEN_LABEL);
  const refresh = control('bar__button bar__refresh', REFRESH_LABEL);
  refresh.disabled = true;
  const branches = mountBranchControl();
  const theme = themeControl();
  bar.append(path, open, refresh, ...branches.parts, theme.label, theme.select);

  const notices = element('div', 'notices');
  notices.setAttribute('role', 'status');

  const stage = element('div', 'stage');

  const failure = element('section', 'failure');
  const headline = element('h2', 'failure__headline');
  const message = element('pre', 'failure__message');
  failure.append(headline, message);
  failure.hidden = true;

  root.replaceChildren(bar, notices, stage, failure);
  path.textContent = repositoryLabel(null);

  return {
    stage,
    open,
    refresh,
    branches,
    theme: theme.select,
    showTheme: (choice: ThemeChoice): void => {
      document.documentElement.dataset['theme'] = choice;
      theme.select.value = choice;
      theme.select.disabled = false;
    },
    showPath: (chosen: string | null): void => {
      path.textContent = repositoryLabel(chosen);
    },
    showFailure: (shown: Failure): void => {
      headline.textContent = failureHeadline(shown.kind);
      message.textContent = shown.message;
      stage.hidden = true;
      failure.hidden = false;
    },
    clearFailure: (): void => {
      failure.hidden = true;
      stage.hidden = false;
    },
    showUnkept: (unkept: UnkeptChoice): void => {
      notices.append(unkeptNotice(unkept));
    },
  };
}
