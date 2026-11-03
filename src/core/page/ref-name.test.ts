import { describe, expect, it } from 'vitest';

import { isRefName } from './ref-name';

/**
 * Which names git's ref-name rules accept, one rule a case.
 *
 * Each refused name is otherwise a name the function accepts, with the one
 * thing the rule refuses put into it, so that a rule removed from the function
 * fails here under that rule's name, and each accepted name stands beside a
 * refused one to keep a rule from refusing more than it says.
 */

const branch = (rest: string): string => `refs/heads/${rest}`;

describe('isRefName, the names review round 04 sent', () => {
  it('refuses a branch name followed by a symmetric range to the stash', () => {
    expect(isRefName('refs/heads/side...refs/stash')).toBe(false);
  });

  it('refuses a branch name followed by a range to HEAD', () => {
    expect(isRefName('refs/heads/side..HEAD')).toBe(false);
  });
});

describe('isRefName, names every rule accepts', () => {
  it('accepts a local branch, a remote-tracking branch and a branch of several levels', () => {
    expect(isRefName(branch('side'))).toBe(true);
    expect(isRefName('refs/remotes/origin/main')).toBe(true);
    expect(isRefName(branch('feature/deep/name'))).toBe(true);
  });

  it('accepts a name of two levels, the fewest the rules allow', () => {
    expect(isRefName('heads/side')).toBe(true);
  });

  it('accepts characters past U+007F, a supplementary one included', () => {
    expect(isRefName(branch('ramificação'))).toBe(true);
    expect(isRefName(branch('\u0080'))).toBe(true);
    expect(isRefName(branch('emoji-\u{1f600}'))).toBe(true);
  });

  it('accepts punctuation no rule names', () => {
    expect(isRefName(branch('!#$%&()+,;<=>"\'`{|}'))).toBe(true);
    expect(isRefName(branch('-starts-with-a-dash'))).toBe(true);
    expect(isRefName(branch('a@b'))).toBe(true);
    expect(isRefName(branch('a{b}'))).toBe(true);
  });

  it('accepts a single dot inside a component, and a dot ending a component that is not the last', () => {
    expect(isRefName(branch('v1.2'))).toBe(true);
    expect(isRefName(branch('a./b'))).toBe(true);
  });

  it('accepts `.lock` that does not end a component', () => {
    expect(isRefName(branch('x.lockable'))).toBe(true);
    expect(isRefName(branch('lock'))).toBe(true);
    expect(isRefName(branch('a.lockb/c'))).toBe(true);
  });
});

describe('isRefName, the rules that refuse anywhere in a name', () => {
  it('refuses two consecutive dots', () => {
    expect(isRefName(branch('a..b'))).toBe(false);
    expect(isRefName(branch('a/..'))).toBe(false);
  });

  it('refuses `@{`', () => {
    expect(isRefName(branch('main@{1}'))).toBe(false);
    expect(isRefName(branch('@{-1}'))).toBe(false);
  });

  it('refuses a control character, from U+0000 to U+001F', () => {
    expect(isRefName(branch('a\u0000b'))).toBe(false);
    expect(isRefName(branch('a\u0009b'))).toBe(false);
    expect(isRefName(branch('a\nb'))).toBe(false);
    expect(isRefName(branch('a\u001fb'))).toBe(false);
  });

  it('refuses DEL, U+007F', () => {
    expect(isRefName(branch('a\u007fb'))).toBe(false);
  });

  it('refuses a space', () => {
    expect(isRefName(branch('a b'))).toBe(false);
  });

  it('refuses a tilde, a caret and a colon', () => {
    expect(isRefName(branch('side~1'))).toBe(false);
    expect(isRefName(branch('side^2'))).toBe(false);
    expect(isRefName(branch('side:file.txt'))).toBe(false);
  });

  it('refuses a question mark, an asterisk and an open bracket', () => {
    expect(isRefName(branch('side?'))).toBe(false);
    expect(isRefName(branch('side*'))).toBe(false);
    expect(isRefName(branch('side[1]'))).toBe(false);
  });

  it('refuses a backslash', () => {
    expect(isRefName(branch('a\\b'))).toBe(false);
  });
});

describe('isRefName, the rules of the ends and the components', () => {
  it('refuses a name of one level, the single character `@` among them', () => {
    expect(isRefName('main')).toBe(false);
    expect(isRefName('HEAD')).toBe(false);
    expect(isRefName('@')).toBe(false);
  });

  it('refuses the empty name', () => {
    expect(isRefName('')).toBe(false);
  });

  it('refuses a name beginning or ending with a slash', () => {
    expect(isRefName('/refs/heads/side')).toBe(false);
    expect(isRefName(branch('side/'))).toBe(false);
  });

  it('refuses two consecutive slashes', () => {
    expect(isRefName('refs/heads//side')).toBe(false);
  });

  it('refuses a component beginning with a dot', () => {
    expect(isRefName(branch('.hidden'))).toBe(false);
    expect(isRefName(branch('a/.b/c'))).toBe(false);
    expect(isRefName('.refs/heads/side')).toBe(false);
  });

  it('refuses a component ending with `.lock`', () => {
    expect(isRefName(branch('side.lock'))).toBe(false);
    expect(isRefName(branch('a.lock/b'))).toBe(false);
  });

  it('refuses a name ending with a dot', () => {
    expect(isRefName(branch('side.'))).toBe(false);
  });
});
