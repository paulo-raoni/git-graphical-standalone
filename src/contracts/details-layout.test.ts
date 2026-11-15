import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DETAILS_LAYOUT,
  DEFAULT_DETAILS_OPTIONS,
  draggedDivider,
  draggedHeight,
  heightRoom,
  keptDetailsLayout,
  keptDetailsOptions,
} from './index';

const OPTIONS = {
  place: 'docked',
  autoCenter: false,
  defaultFileView: 'list',
  compactFolders: false,
  statusLetters: true,
};
const LAYOUT = { height: 300, divider: 0.4, fileView: 'list' };

/** `record` without `field`. */
function without(record: object, field: string): object {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== field));
}

describe('the defaults', () => {
  it('are the two equal panes of 250 pixels, inline, centred, in a tree', () => {
    expect(DEFAULT_DETAILS_OPTIONS).toEqual({
      place: 'inline',
      autoCenter: true,
      defaultFileView: 'tree',
      compactFolders: true,
      statusLetters: false,
    });
    expect(DEFAULT_DETAILS_LAYOUT).toEqual({ height: 250, divider: 0.5, fileView: null });
  });
});

describe('keptDetailsOptions', () => {
  it('answers a new object holding the five fields', () => {
    const answer = keptDetailsOptions({ ...OPTIONS, extra: 1 });
    expect(answer).toEqual(OPTIONS);
    expect(answer).not.toHaveProperty('extra');
    expect(keptDetailsOptions(DEFAULT_DETAILS_OPTIONS)).toEqual(DEFAULT_DETAILS_OPTIONS);
  });

  it.each(['place', 'autoCenter', 'defaultFileView', 'compactFolders', 'statusLetters'])(
    'refuses a record missing %s',
    (field) => {
      expect(keptDetailsOptions(without(OPTIONS, field))).toBeNull();
    },
  );

  it.each([
    ['place', 'floating'],
    ['place', 1],
    ['autoCenter', 'yes'],
    ['autoCenter', 1],
    ['defaultFileView', 'grid'],
    ['defaultFileView', null],
    ['compactFolders', 0],
    ['statusLetters', 'true'],
  ])('refuses %s of %j', (field, value) => {
    expect(keptDetailsOptions({ ...OPTIONS, [field]: value })).toBeNull();
  });

  it.each([null, undefined, 'options', 7, []])('refuses %j', (value) => {
    expect(keptDetailsOptions(value)).toBeNull();
  });
});

describe('keptDetailsLayout', () => {
  it('answers a new object holding the three fields', () => {
    const answer = keptDetailsLayout({ ...LAYOUT, extra: 1 });
    expect(answer).toEqual(LAYOUT);
    expect(answer).not.toHaveProperty('extra');
    expect(keptDetailsLayout(DEFAULT_DETAILS_LAYOUT)).toEqual(DEFAULT_DETAILS_LAYOUT);
    expect(keptDetailsLayout({ ...LAYOUT, fileView: 'tree' })).toEqual({
      ...LAYOUT,
      fileView: 'tree',
    });
  });

  it.each(['height', 'divider', 'fileView'])('refuses a record missing %s', (field) => {
    expect(keptDetailsLayout(without(LAYOUT, field))).toBeNull();
  });
});

describe('the fields of a kept layout', () => {
  it.each([
    [120, true],
    [121, true],
    [4095, true],
    [4096, true],
    [119, false],
    [4097, false],
    [250.5, false],
    [120.0000001, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    ['250', false],
    [null, false],
  ])('height %j is kept: %j', (height, kept) => {
    expect(keptDetailsLayout({ ...LAYOUT, height }) !== null).toBe(kept);
  });

  it.each([
    [0.2, true],
    [0.2000001, true],
    [0.5, true],
    [0.7999999, true],
    [0.8, true],
    [0.1999999, false],
    [0.8000001, false],
    [0.9, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    ['0.5', false],
    [null, false],
  ])('divider %j is kept: %j', (divider, kept) => {
    expect(keptDetailsLayout({ ...LAYOUT, divider }) !== null).toBe(kept);
  });

  it.each([
    ['grid', false],
    [1, false],
    [undefined, false],
    [null, true],
    ['tree', true],
    ['list', true],
  ])('file view %j is kept: %j', (fileView, kept) => {
    expect(keptDetailsLayout({ ...LAYOUT, fileView }) !== null).toBe(kept);
  });

  it.each([null, undefined, 'layout', 7, []])('refuses %j', (value) => {
    expect(keptDetailsLayout(value)).toBeNull();
  });
});

describe('heightRoom', () => {
  it('leaves one row inline and the head with three rows docked', () => {
    expect(heightRoom('inline', 500, 24)).toBe(476);
    expect(heightRoom('docked', 500, 24)).toBe(404);
  });

  it('never gives less than the minimum, nor more than a record may claim', () => {
    expect(heightRoom('inline', 130, 24)).toBe(120);
    expect(heightRoom('inline', 144, 24)).toBe(120);
    expect(heightRoom('inline', 145, 24)).toBe(121);
    expect(heightRoom('docked', 100, 24)).toBe(120);
    expect(heightRoom('inline', 9000, 24)).toBe(4096);
    expect(heightRoom('inline', 4120, 24)).toBe(4096);
    expect(heightRoom('inline', 4119, 24)).toBe(4095);
  });
});

describe('draggedHeight', () => {
  it('rounds to a whole pixel', () => {
    expect(draggedHeight(300.4, 400)).toBe(300);
    expect(draggedHeight(300.5, 400)).toBe(301);
  });

  it('holds the minimum and the room, at, under and over', () => {
    expect(draggedHeight(120, 400)).toBe(120);
    expect(draggedHeight(119, 400)).toBe(120);
    expect(draggedHeight(-50, 400)).toBe(120);
    expect(draggedHeight(400, 400)).toBe(400);
    expect(draggedHeight(401, 400)).toBe(400);
    expect(draggedHeight(900, 400)).toBe(400);
    expect(draggedHeight(399, 400)).toBe(399);
  });

  it('holds the minimum when the list is too short for it', () => {
    expect(draggedHeight(300, heightRoom('inline', 100, 24))).toBe(120);
  });
});

describe('draggedDivider', () => {
  it('is the pointer is share of the two panes', () => {
    expect(draggedDivider(300, 100, 400)).toBe(0.5);
    expect(draggedDivider(200, 100, 400)).toBe(0.25);
  });

  it('holds the share from a fifth to four fifths, at, under and over', () => {
    expect(draggedDivider(180, 100, 400)).toBe(0.2);
    expect(draggedDivider(179, 100, 400)).toBe(0.2);
    expect(draggedDivider(0, 100, 400)).toBe(0.2);
    expect(draggedDivider(420, 100, 400)).toBe(0.8);
    expect(draggedDivider(421, 100, 400)).toBe(0.8);
    expect(draggedDivider(900, 100, 400)).toBe(0.8);
    expect(draggedDivider(181, 100, 400)).toBeCloseTo(0.2025, 10);
  });

  it('answers the default for panes with no width', () => {
    expect(draggedDivider(300, 100, 0)).toBe(0.5);
    expect(draggedDivider(300, 100, -4)).toBe(0.5);
  });
});
