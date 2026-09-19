import { RefKind } from '../contracts/index';

import { laneColour } from './palette';
import type { RowLabel, RowView } from './row-model';

/**
 * One element of the row pool: the five cells of a row, built once and
 * **rewritten in place** for as long as the window is open.
 *
 * Nothing here creates or destroys a row. `createRowElement` is called once per
 * pool slot when the view is mounted or the window is resized, and `writeRow`
 * is called when a slot's row index changes — which, with the modulo assignment
 * in `./geometry`, is once per row that enters the view rather than once per
 * row on screen. Scrolling by one row rewrites one element.
 *
 * Everything is assembled from elements and `textContent`, never from a markup
 * string, so no path in the renderer can interpret a subject or a branch name as
 * markup. The document's content security policy forbids inline script; this is
 * the same rule applied to the code that runs after it. Colours reach the DOM
 * through `style.setProperty`, which is the CSSOM rather than a `style`
 * attribute, and is therefore not what `style-src 'self'` refuses.
 */

/** The class that gives a label its shape, by kind. */
const LABEL_CLASS: Readonly<Record<RefKind, string>> = {
  [RefKind.LocalHead]: 'ref ref--head',
  [RefKind.RemoteBranch]: 'ref ref--remote',
  [RefKind.Tag]: 'ref ref--tag',
  [RefKind.RemoteSymbolicHead]: 'ref',
  [RefKind.Stash]: 'ref',
};

/** The cells of one row, kept so that writing one does not have to find them. */
export interface RowElement {
  readonly root: HTMLElement;
  readonly labels: HTMLElement;
  readonly subject: HTMLElement;
  readonly date: HTMLElement;
  readonly author: HTMLElement;
  readonly hash: HTMLElement;
}

function cell(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

/** Build one pool element. Called once per slot, never while scrolling. */
export function createRowElement(): RowElement {
  const root = cell('row');
  const labels = document.createElement('span');
  labels.className = 'row__refs';
  const subject = document.createElement('span');
  subject.className = 'row__subject';
  const description = cell('row__cell row__description');
  description.append(labels, subject);
  const date = cell('row__cell');
  const author = cell('row__cell');
  const hash = cell('row__cell row__hash');
  root.append(cell('row__graph'), description, date, author, hash);
  return { root, labels, subject, date, author, hash };
}

function labelElement(label: RowLabel, colour: string): HTMLElement {
  const element = document.createElement('span');
  element.className = LABEL_CLASS[label.kind];
  element.style.setProperty('--ref-colour', colour);
  element.textContent = label.name;
  return element;
}

/**
 * Put `view` into `element` and move it to `top`, measured inside the spacer.
 *
 * The move is a `transform` rather than a `top`, so the browser reuses the
 * layer it already has instead of laying the row out again
 * (`docs/ADR-0002-architecture-and-performance.md` decision 5).
 */
export function writeRow(element: RowElement, view: RowView, top: number): void {
  const colour = laneColour(view.colourIndex);
  element.root.style.transform = `translateY(${String(top)}px)`;
  element.root.classList.toggle('row--uncommitted', view.isUncommitted);
  element.labels.replaceChildren(...view.labels.map((label) => labelElement(label, colour)));
  element.subject.textContent = view.description;
  element.date.textContent = view.date;
  element.author.textContent = view.author;
  element.hash.textContent = view.hash;
}
