import type { Failure } from '../contracts/index';

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
 * its two panes is showing, which is why the whole of the wiring is in
 * `./renderer.ts` and the whole of the wording is in `./status-text.ts`.
 *
 * Everything is built from elements and `textContent`, never from a markup
 * string, so a repository path and a message from git cannot be interpreted as
 * markup — the same rule `./row-element.ts` follows for a commit subject.
 */

/** What the two controls say when they are resting. */
const OPEN_LABEL = 'Open Repository';
const REFRESH_LABEL = 'Refresh';

/** What the shell hands `./renderer.ts` to drive it with. */
export interface Shell {
  /** The element `mountGraphTable` owns. */
  readonly stage: HTMLElement;
  /** The control that asks for a folder chooser. */
  readonly open: HTMLButtonElement;
  /** The control that re-reads the open repository. */
  readonly refresh: HTMLButtonElement;
  /** Show which repository the window is looking at, or that there is none. */
  readonly showPath: (path: string | null) => void;
  /** Replace the table with the failure, in git's own words. */
  readonly showFailure: (failure: Failure) => void;
  /** Put the table back. */
  readonly clearFailure: () => void;
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
 */
export function mountShell(root: HTMLElement): Shell {
  const bar = element('header', 'bar');
  const path = element('span', 'bar__path');
  const open = control('bar__button bar__open', OPEN_LABEL);
  const refresh = control('bar__button bar__refresh', REFRESH_LABEL);
  refresh.disabled = true;
  bar.append(path, open, refresh);

  const stage = element('div', 'stage');

  const failure = element('section', 'failure');
  const headline = element('h2', 'failure__headline');
  const message = element('pre', 'failure__message');
  failure.append(headline, message);
  failure.hidden = true;

  root.replaceChildren(bar, stage, failure);
  path.textContent = repositoryLabel(null);

  return {
    stage,
    open,
    refresh,
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
  };
}
