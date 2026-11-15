import { describe, expect, it } from 'vitest';

import { gateModule } from './report';

/**
 * The licences gate's message, held: `findingsFor` of `scripts/gates/licences.js`,
 * over the committed `scripts/gates/licence-allow-list.json`, for packages named
 * here. No checker runs and no package is read from `node_modules`: what is held
 * is what the gate says of an entry the checker reported, not the checker.
 *
 * Until E04-M01-S07 every refusal said the licence "is not on the allow-list",
 * also for a package that the list names under an exception for another licence,
 * so the message hid which of the two rules refused it. Each refusal now says
 * why, and these cases hold both reasons, and that an exception allows its own
 * licence for its own package and nothing else. The verdicts are unchanged.
 */

interface Licences {
  readonly findingsFor: (identifier: string, entry: { readonly licenses?: unknown }) => string[];
}

const { findingsFor } = await gateModule<Licences>('licences.js');

describe('a package the gate refuses is told why', () => {
  it('a licence not on the list, for a package no exception names', () => {
    expect(findingsFor('copyleft@1.0.0', { licenses: 'GPL-3.0' })).toEqual([
      'copyleft@1.0.0 is under "GPL-3.0", which is not on the allow-list, and no exception names copyleft',
    ]);
  });

  it('a licence not on the list, for a package whose exception is for another', () => {
    expect(findingsFor('lightningcss@1.30.0', { licenses: 'GPL-3.0' })).toEqual([
      'lightningcss@1.30.0 is under "GPL-3.0", which is not on the allow-list, and the exception for lightningcss allows "MPL-2.0" only',
    ]);
  });

  it('a licence the checker could not determine, for a scoped package', () => {
    expect(findingsFor('@scope/unread@2.0.0', {})).toEqual([
      '@scope/unread@2.0.0 is under "UNKNOWN", which is not on the allow-list, and no exception names @scope/unread',
    ]);
  });

  it('each refused licence of a package under several, and only those', () => {
    expect(findingsFor('mixed@1.0.0', { licenses: ['MIT', 'GPL-3.0', 'MPL-2.0'] })).toEqual([
      'mixed@1.0.0 is under "GPL-3.0", which is not on the allow-list, and no exception names mixed',
      'mixed@1.0.0 is under "MPL-2.0", which is not on the allow-list, and no exception names mixed',
    ]);
  });
});

describe('a package the gate accepts is not reported', () => {
  it('a licence on the list', () => {
    expect(findingsFor('@scope/permissive@1.0.0', { licenses: 'MIT' })).toEqual([]);
  });

  it('the licence an exception names, for the package it names', () => {
    expect(findingsFor('lightningcss@1.30.0', { licenses: 'MPL-2.0' })).toEqual([]);
  });
});
