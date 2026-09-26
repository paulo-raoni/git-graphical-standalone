import { describe, expect, it } from 'vitest';

import { FailureKind } from '../contracts/index';

import { failureHeadline, repositoryLabel } from './status-text';

/**
 * The first colocated test of `src/ui/`.
 *
 * Until E01-M01-S06 there could not be one: `ui-only-contracts` in
 * `.dependency-cruiser.cjs` let this ring name `src/contracts/` and itself and
 * nothing else, with no carve-out for a test file, so a `src/ui/*.test.ts` that
 * imported `vitest` failed `gates:boundaries` and S05's pure tests had to live
 * on the end-to-end runner. That slice raised it; this one added the same pair
 * of rules `src/contracts/` and `src/core/` already had.
 */

describe('the sentence above git’s own message', () => {
  it('has one for every kind of failure the contract defines', () => {
    const kinds = Object.values(FailureKind);
    const headlines = kinds.map((kind) => failureHeadline(kind));
    expect(kinds.length).toBeGreaterThan(0);
    expect(headlines.every((headline) => headline.length > 0)).toBe(true);
    expect(new Set(headlines).size).toBe(kinds.length);
  });

  it('says which of the three the user met, so the view can offer the right thing', () => {
    expect(failureHeadline(FailureKind.GitMissing)).toContain('found');
    expect(failureHeadline(FailureKind.NotARepository)).toContain('not a git repository');
    expect(failureHeadline(FailureKind.GitFailed)).not.toBe(
      failureHeadline(FailureKind.NotARepository),
    );
  });
});

describe('the repository the bar is looking at', () => {
  it('is the path when there is one', () => {
    expect(repositoryLabel('C:\\somewhere\\a-repository')).toBe('C:\\somewhere\\a-repository');
  });

  it('says so when there is none, rather than showing an empty bar', () => {
    expect(repositoryLabel(null).length).toBeGreaterThan(0);
    expect(repositoryLabel(null)).not.toBe(repositoryLabel(''));
  });
});
