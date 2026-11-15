import { describe, expect, it } from 'vitest';

import type { Files } from './report';
import { fixture, gateModule, mutantsOf } from './report';

/**
 * The mutation gate's reading of a coloured run, held: `plainFiles` of
 * `scripts/gates/mutation-output.js`, and through it the gate's own tally.
 *
 * Every clause of the gate reads a kill's recorded output with regular
 * expressions, and a colour code in front of vitest's `Tests` line, or between it
 * and its count, hides the count from the failing-test reading. A GitHub Actions
 * runner colours every run, so the gate strips the codes as it reads the report
 * (E03-M01-S03). Until this file no check that runs on this machine read a
 * coloured output: an agent's session starts vitest without colour, and E03-M01's
 * review round 01 broke `mutation-output.js` with every local gate green.
 *
 * `fixtures/coloured-kills.json` is a real report trimmed to a few kills, cut by
 * E04-M01-S01 from a full run of `node scripts/gates/mutation.js` with
 * `FORCE_COLOR=1` and `CI=true` set, so that vitest coloured its output as it
 * does on a runner; its `comment` names the run and what each kill was chosen
 * for. It holds, among them, a control sequence that Stryker's `os.EOL` join cut
 * in two, which is the part of `ESCAPE_SEQUENCE` a fixture of whole sequences
 * would never exercise.
 *
 * **The reading held is `ESCAPE_SEQUENCE`**, through `plainOutput` and
 * `plainFiles`: every escape sequence out, split ones with their line break,
 * and nothing else. The independent reading below, `withoutSequences`, is a
 * character walk written for this check, so that a pattern that removes a
 * character too many or too few disagrees with it.
 */

interface Output {
  readonly plainFiles: (files: Files) => Files;
  readonly plainOutput: (text: string) => string;
}

interface Tally {
  readonly kills: {
    readonly clock: readonly string[];
    readonly unreadable: readonly string[];
    readonly noFailure: readonly string[];
  };
}

interface Gate {
  readonly tally: (files: Files) => Tally;
}

interface Fixture {
  readonly comment: string;
  readonly files: Files;
}

const output = await gateModule<Output>('mutation-output.js');
const gate = await gateModule<Gate>('mutation.js');
const coloured = (fixture('coloured-kills.json') as Fixture).files;
const reasons = mutantsOf(coloured).map(({ mutant }) => mutant.statusReason ?? '');

const ESC = String.fromCharCode(0x1b);

/** A control sequence's parameter and intermediate bytes, and the line break a join may put in it. */
const isInside = (character: string): boolean =>
  (character >= ' ' && character <= '?') || character === '\r' || character === '\n';
const isFinal = (character: string): boolean => character >= '@' && character <= '~';

/** Where the control sequence starting with the `ESC` at `at` ends, one past its final byte. */
function sequenceEnd(text: string, at: number): number {
  let end = at + 1;
  while (text[end] === '\r' || text[end] === '\n') end += 1;
  if (text[end] === '[') end += 1;
  while (end < text.length && isInside(text.charAt(end))) end += 1;
  return end < text.length && isFinal(text.charAt(end)) ? end + 1 : end;
}

/**
 * The text with every control sequence (`ESC [` … one final byte) taken out,
 * walking it a character at a time, with a line break inside a sequence taken out
 * with it: the gate's reading, written a second way.
 */
function withoutSequences(text: string): string {
  let kept = '';
  let at = 0;
  while (at < text.length) {
    if (text[at] === ESC) {
      at = sequenceEnd(text, at);
    } else {
      kept += text.charAt(at);
      at += 1;
    }
  }
  return kept;
}

describe('the fixture is a coloured run', () => {
  it('holds kills whose every output carries escape codes', () => {
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    for (const reason of reasons) expect(reason).toContain(ESC);
  });

  it('hides every failing test from the gate when it is read without stripping', () => {
    expect(gate.tally(coloured).kills.noFailure).toHaveLength(reasons.length);
  });

  it('holds a control sequence that a line break cuts in two', () => {
    expect(reasons.some((reason) => new RegExp(`${ESC}\\[[0-?]*\\r?\\n`).test(reason))).toBe(true);
  });
});

describe('the gate reads the coloured run as plain text', () => {
  const plain = output.plainFiles(coloured);
  const plainReasons = mutantsOf(plain).map(({ mutant }) => mutant.statusReason ?? '');

  it('leaves no escape character in any output', () => {
    for (const reason of plainReasons) expect(reason).not.toContain(ESC);
  });

  it('takes out the sequences and nothing else', () => {
    expect(plainReasons).toEqual(reasons.map(withoutSequences));
  });

  it('finds the failing test of every kill, and no clock word it cannot read', () => {
    const { kills } = gate.tally(plain);
    expect(kills.noFailure).toEqual([]);
    expect(kills.unreadable).toEqual([]);
  });

  it('is the identity on text that carries no escape sequence', () => {
    for (const reason of plainReasons) expect(output.plainOutput(reason)).toBe(reason);
  });
});
