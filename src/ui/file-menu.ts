import type { FileView } from '../contracts/index';

/**
 * The one menu of the changed-files pane (E04-M01-S10): the context menu of a
 * file and the options menu share it.
 *
 * **One element for the whole view**, built when the view is mounted and
 * rewritten at each opening, never one per row
 * (`docs/ADR-0002-architecture-and-performance.md` decision 5). It is built from
 * elements and `textContent`, so no path is ever read as markup, and it holds no
 * rule about what an entry does: the pane says, this module shows.
 *
 * It closes when an entry is chosen, on a click anywhere else, when anything
 * scrolls, when the window loses focus and when the pane asks. Escape is S11's.
 */

/** One line of the menu: a heading, or an entry that runs something when chosen. */
export interface MenuEntry {
  readonly label: string;
  /** A heading is shown and cannot be chosen. */
  readonly heading?: boolean;
  /** Whether the entry is the chosen one of its heading's values. */
  readonly selected?: boolean;
  readonly run?: () => void;
}

/** One value of an option, as the options menu lists it. */
export interface OptionChoice {
  readonly label: string;
  readonly selected: () => boolean;
  readonly choose: () => void;
}

/** One option and its values; S12 adds its own through `FilePane.addOptions`. */
export interface OptionGroup {
  readonly title: string;
  readonly choices: readonly OptionChoice[];
}

/** The options of the pane that the menu changes. */
export interface Settings {
  /** The view of a repository on which no view button was pressed. */
  defaultView: FileView;
  compact: boolean;
  letters: boolean;
}

/** The options menu's lines: each group's title, then its values, the chosen one marked. */
export function optionEntries(groups: readonly OptionGroup[]): MenuEntry[] {
  return groups.flatMap((group) => [
    { label: group.title, heading: true },
    ...group.choices.map((one) => ({
      label: one.label,
      selected: one.selected(),
      run: one.choose,
    })),
  ]);
}

/**
 * The built-in options: the default view, compact folders and the status
 * letters. `changed` is called after a value is set.
 */
export function optionGroups(settings: Settings, changed: () => void): OptionGroup[] {
  const choice = (label: string, selected: () => boolean, set: () => void): OptionChoice => ({
    label,
    selected,
    choose: (): void => {
      set();
      changed();
    },
  });
  const view = (name: FileView, label: string): OptionChoice =>
    choice(
      label,
      () => settings.defaultView === name,
      () => {
        settings.defaultView = name;
      },
    );
  const flag = (key: 'compact' | 'letters', on: boolean): OptionChoice =>
    choice(
      on ? 'On' : 'Off',
      () => settings[key] === on,
      () => {
        settings[key] = on;
      },
    );
  return [
    { title: 'Default File View', choices: [view('tree', 'Tree'), view('list', 'List')] },
    { title: 'Compact Folders', choices: [flag('compact', true), flag('compact', false)] },
    { title: 'Status Letters', choices: [flag('letters', true), flag('letters', false)] },
  ];
}

/** What the pane drives the menu with. */
export interface FileMenu {
  readonly root: HTMLElement;
  /** Show `entries` with the corner at `x`, `y` (window coordinates), moved to stay inside the window. */
  readonly open: (entries: readonly MenuEntry[], x: number, y: number, event: Event) => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
}

/** Keep this far from the window's edge. */
const MARGIN = 4;

function line(entry: MenuEntry, close: () => void): HTMLElement {
  if (entry.heading === true) {
    const heading = document.createElement('div');
    heading.className = 'files__menu-heading';
    heading.textContent = entry.label;
    return heading;
  }
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'files__menu-item';
  item.setAttribute('role', 'menuitem');
  const mark = document.createElement('span');
  mark.className = 'files__menu-mark';
  mark.textContent = entry.selected === true ? '●' : '';
  const label = document.createElement('span');
  label.textContent = entry.label;
  item.append(mark, label);
  item.addEventListener('click', () => {
    close();
    entry.run?.();
  });
  return item;
}

/** Build the menu, hidden, and register the listeners that close it. */
export function createFileMenu(): FileMenu {
  const root = document.createElement('div');
  root.className = 'files__menu';
  root.setAttribute('role', 'menu');
  root.hidden = true;
  let opener: Event | null = null;
  const close = (): void => {
    opener = null;
    root.hidden = true;
  };
  document.addEventListener('click', (event) => {
    if (event !== opener && !root.contains(event.target as Node | null)) {
      close();
    }
  });
  // In the capture phase, so that a right-click elsewhere closes this menu
  // before the pane's own handler opens it again.
  document.addEventListener('contextmenu', close, true);
  document.addEventListener('scroll', close, true);
  window.addEventListener('blur', close);
  return {
    root,
    open: (entries: readonly MenuEntry[], x: number, y: number, event: Event): void => {
      root.replaceChildren(...entries.map((entry) => line(entry, close)));
      root.hidden = false;
      opener = event;
      const left = Math.min(x, window.innerWidth - root.offsetWidth - MARGIN);
      const top = Math.min(y, window.innerHeight - root.offsetHeight - MARGIN);
      root.style.left = `${String(Math.max(MARGIN, left))}px`;
      root.style.top = `${String(Math.max(MARGIN, top))}px`;
    },
    close,
    isOpen: (): boolean => !root.hidden,
  };
}
