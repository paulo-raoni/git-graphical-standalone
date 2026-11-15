import { describe, expect, it } from 'vitest';

import { unkeptChoiceOf } from './unkept-choice';

/**
 * What the page is handed for a message on `CHANNELS.unkeptChoice`: the two
 * strings and nothing else, or nothing at all.
 */
describe('unkeptChoiceOf', () => {
  it('answers the two strings of a payload', () => {
    const payload = { what: 'theme choice', file: '/profile/theme' };
    expect(unkeptChoiceOf(payload)).toEqual(payload);
  });

  it('answers a new object, holding the two fields alone', () => {
    const payload = { what: 'branch selection', file: '/profile/x', extra: 'not passed on' };
    const answered = unkeptChoiceOf(payload);
    expect(answered).toStrictEqual({ what: 'branch selection', file: '/profile/x' });
    expect(answered).not.toBe(payload);
  });

  it('keeps empty strings, which are still strings', () => {
    expect(unkeptChoiceOf({ what: '', file: '' })).toEqual({ what: '', file: '' });
  });

  it('refuses a payload whose what is not a string', () => {
    expect(unkeptChoiceOf({ what: 1, file: '/profile/theme' })).toBeNull();
    expect(unkeptChoiceOf({ file: '/profile/theme' })).toBeNull();
  });

  it('refuses a payload whose file is not a string', () => {
    expect(unkeptChoiceOf({ what: 'theme choice', file: null })).toBeNull();
    expect(unkeptChoiceOf({ what: 'theme choice' })).toBeNull();
  });

  it('refuses what is not an object, without throwing', () => {
    for (const value of [null, undefined, 'theme choice', 7, true]) {
      expect(unkeptChoiceOf(value)).toBeNull();
    }
  });
});
