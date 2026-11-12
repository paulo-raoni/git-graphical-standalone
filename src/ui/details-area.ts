import type { CommitDetails, DetailsPerson, UncommittedDetails } from '../contracts/index';

/**
 * The area that opens under a row, and what it says (E04-M01-S09).
 *
 * **One element for the whole view**, built when the view is mounted and
 * rewritten at each open, never one per row
 * (`docs/ADR-0002-architecture-and-performance.md` decision 5). Like a row it is
 * built from elements and `textContent` alone, so no subject, name or path is
 * ever read as markup.
 *
 * It holds no rule about where it sits or when it opens: `./graph-table` places
 * it, and this module writes into it.
 */

import { createFilePane } from './file-pane';
import type { FilePane } from './file-pane';

/** What the left pane says while the reply is awaited. */
export const LOADING_NOTE = 'Loading…';

/** What the left pane says for the uncommitted changes. */
const UNCOMMITTED_NOTE = 'Displaying all uncommitted changes.';

/** What the Parents line says for a root commit. */
const NO_PARENTS = 'None';

const DAYS = 'SunMonTueWedThuFriSat';
const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';

/** The pieces of the area, kept so that writing one does not have to find them. */
export interface DetailsArea {
  readonly root: HTMLElement;
  readonly info: HTMLElement;
  readonly files: HTMLElement;
  readonly close: HTMLButtonElement;
  /** The changed files, as a tree or a list (E04-M01-S10). */
  readonly pane: FilePane;
  /** The pane's one menu element, which the view places where `position: fixed` is the window's. */
  readonly menu: HTMLElement;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

/** Build the area, hidden: the left pane, the files pane and the controls' column. */
export function createDetailsArea(): DetailsArea {
  const root = make('div', 'details');
  const info = make('div', 'details__info');
  const files = make('div', 'details__files');
  const controls = make('div', 'details__controls');
  const close = make('button', 'details__close');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close';
  close.ariaLabel = 'Close';
  const pane = createFilePane();
  files.append(pane.root);
  controls.append(close, ...pane.controls);
  root.append(info, files, controls);
  root.hidden = true;
  return { root, info, files, close, pane, menu: pane.menu };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A moment as the left pane spells it, in the person's own recorded offset:
 * `Sun Oct 18 2026 09:00:00 GMT-0300`.
 *
 * Git stores an offset and no zone name, and a text that does not depend on the
 * machine's time zone is one a case can compare with a literal. The reference's
 * own offset rule was not established (E04-M01-S09, item 6).
 */
export function dateText(seconds: number, offsetMinutes: number): string {
  const at = new Date((seconds + offsetMinutes * 60) * 1000);
  const day = at.getUTCDay() * 3;
  const month = at.getUTCMonth() * 3;
  const offset = Math.abs(offsetMinutes);
  const zone = `GMT${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(offset / 60))}${pad(offset % 60)}`;
  const clock = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
  return `${DAYS.slice(day, day + 3)} ${MONTHS.slice(month, month + 3)} ${pad(at.getUTCDate())} ${String(at.getUTCFullYear())} ${clock} ${zone}`;
}

/** One line of the left pane: a bold label, then its value. */
function field(label: string, ...value: (string | Node)[]): HTMLElement {
  const line = make('div', 'details__line');
  const bold = make('span', 'details__label');
  bold.textContent = label;
  line.append(bold, ' ', ...value);
  return line;
}

const personText = (person: DetailsPerson): string => `${person.name} <${person.email}>`;

/** Whether two people are recorded at the same moment: the same time and the same offset. */
function sameMoment(left: DetailsPerson, right: DetailsPerson): boolean {
  return left.time === right.time && left.offsetMinutes === right.offsetMinutes;
}

/**
 * The Parents line: each full hash, comma-separated, a link where `follow` says
 * the parent is a row of the page and plain text where it is not; `None` for a
 * root commit.
 */
function parentsLine(
  parents: readonly string[],
  isRow: (hash: string) => boolean,
  follow: (hash: string) => void,
): HTMLElement {
  const nodes: (string | Node)[] = parents.length === 0 ? [NO_PARENTS] : [];
  for (const [at, hash] of parents.entries()) {
    nodes.push(at === 0 ? '' : ', ');
    if (!isRow(hash)) {
      nodes.push(hash);
      continue;
    }
    const link = make('a', 'details__link');
    link.href = '#';
    link.textContent = hash;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      follow(hash);
    });
    nodes.push(link);
  }
  return field('Parents:', ...nodes);
}

/**
 * A commit's fields, then its message.
 *
 * The dates are one `Date:` line when the author and the committer are recorded
 * at the same moment and `Author Date:` and `Committer Date:` after their people
 * when they are not. The message is as the reply carries it, spaces, tabs and
 * blank lines kept (the stylesheet's `white-space: pre-wrap`), less the one line
 * feed that ends it: git terminates the last line with it, so it begins no
 * further line.
 */
function commitLines(
  details: CommitDetails,
  isRow: (hash: string) => boolean,
  follow: (hash: string) => void,
): HTMLElement[] {
  const { author, committer } = details;
  const dated = (person: DetailsPerson): string => dateText(person.time, person.offsetMinutes);
  const people = sameMoment(author, committer)
    ? [
        field('Author:', personText(author)),
        field('Committer:', personText(committer)),
        field('Date:', dated(committer)),
      ]
    : [
        field('Author:', personText(author)),
        field('Author Date:', dated(author)),
        field('Committer:', personText(committer)),
        field('Committer Date:', dated(committer)),
      ];
  const message = make('div', 'details__message');
  message.textContent = details.message.replace(/\n$/, '');
  return [
    field('Commit:', details.hash),
    parentsLine(details.parents, isRow, follow),
    ...people,
    message,
  ];
}

/** Say `text` in the left pane and nothing in the files pane. */
export function writeNote(area: DetailsArea, text: string): void {
  area.info.textContent = text;
  area.pane.clear();
}

/**
 * Write a reply's details into the area.
 *
 * `isRow` says whether a parent is a loaded row of the page, which is what
 * makes it a link, and `follow` opens that row.
 */
export function writeDetails(
  area: DetailsArea,
  details: CommitDetails | UncommittedDetails,
  isRow: (hash: string) => boolean,
  follow: (hash: string) => void,
): void {
  if ('hash' in details) {
    area.info.replaceChildren(...commitLines(details, isRow, follow));
    area.pane.show(details.files, { kind: 'commit', hash: details.hash });
  } else {
    area.info.textContent = UNCOMMITTED_NOTE;
    area.pane.show(details.files, { kind: 'uncommitted' });
  }
}
