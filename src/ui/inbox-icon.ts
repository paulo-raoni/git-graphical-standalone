/**
 * The outline of an inbox tray, the icon on a stash's label (E04-M01-S14).
 *
 * **Drawn for this project**, not taken from an icon set: a tray seen from the
 * front, its sides sloping out to a flat rim, and the dip in its rim where
 * letters go in, as two strokes on a 16-unit grid. The reference extension was
 * seen to show a white outline of an inbox tray on the stash's colour, and that
 * observation is the whole of what this drawing rests on; no icon file of the
 * reference extension or of any set was opened to make it.
 *
 * It is built from elements, as every label is (`./row-element.ts`), never from
 * markup, and takes its colour from `currentColor`, so the stylesheet decides
 * it.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** The tray's outline, then the rim with its dip, on a 16 by 16 grid. */
const TRAY =
  'M2.5 9.5 4.5 3.5h7l2 6v3h-11z' + // the tray: sloping sides, a flat bottom
  'M2.5 9.5h3l1 1.5h3l1-1.5h3'; //     its rim, dipping in the middle

/** A new inbox tray icon, sized by the stylesheet. */
export function inboxIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', TRAY);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);
  return icon;
}
