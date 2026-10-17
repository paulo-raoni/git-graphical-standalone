import { describe, expect, it } from 'vitest';

import { compareInRegime, compareWithBaseline, limitsIn, regimeOf } from './baselines';
import type { Baseline, Regime } from './baselines';

/**
 * The code every budget verdict passes through, held with chosen inputs.
 *
 * The gates call `perf/baselines.ts` with this machine's environment and this
 * machine's readings only, and those sit inside every limit, so an edit to the
 * regime or to the order of the comparisons changes no verdict there. Nothing
 * here reads `process.env` or takes a measurement: every environment and every
 * reading is written out, so the file decides the same way in both regimes. It
 * holds no time, so `npm run gates:perf` runs it (`AGENTS.md` §11, *Gate
 * tiers*).
 */

/** A wall-clock entry shaped like `parseMicrosecondsPerCommit`. */
const timed: Baseline = {
  baseline: 14.579,
  ceiling: 50,
  tolerance: 1.5,
  ciTolerance: 4,
  unit: 'microseconds',
};

/** A wall-clock entry with no budget of its own, shaped like `coldStartOpenMilliseconds`. */
const timedWithoutCeiling: Baseline = {
  baseline: 1040,
  tolerance: 1.5,
  ciTolerance: 4,
  unit: 'milliseconds',
};

/** A counter with a budget: no tolerance, and the same on every machine. */
const counter: Baseline = { baseline: 100, ceiling: 120, unit: 'operations' };

/** A counter with nothing but its baseline. */
const bareCounter: Baseline = { baseline: 100, unit: 'operations' };

const regimes: readonly Regime[] = ['strict', 'ci'];

describe('regimeOf', () => {
  it('holds a machine that does not declare itself to the strict limits', () => {
    expect(regimeOf({})).toBe('strict');
    expect(regimeOf({ CI: undefined })).toBe('strict');
    expect(regimeOf({ CI: '' })).toBe('strict');
    expect(regimeOf({ CI: '   ' })).toBe('strict');
  });

  it.each(['0', 'false', 'FALSE', 'False', ' false ', ' 0 ', '\tFalse\n'])(
    'reads CI=%j as the strict regime',
    (flag) => {
      expect(regimeOf({ CI: flag })).toBe('strict');
    },
  );

  it.each(['true', 'TRUE', ' true ', '1'])('reads CI=%j as the CI regime', (flag) => {
    expect(regimeOf({ CI: flag })).toBe('ci');
  });

  it('reads no variable but CI', () => {
    expect(regimeOf({ ci: 'true', CONTINUOUS_INTEGRATION: 'true' })).toBe('strict');
  });
});

describe('limitsIn', () => {
  it.each([timed, timedWithoutCeiling, counter, bareCounter])(
    'returns entry %# unchanged in the strict regime',
    (entry) => {
      expect(limitsIn(entry, 'strict')).toBe(entry);
    },
  );

  it('multiplies the tolerance and the ceiling by ciTolerance in the CI regime', () => {
    const widened = limitsIn(timed, 'ci');
    expect(widened.tolerance).toBe(6);
    expect(widened.ceiling).toBe(200);
    expect(widened).toStrictEqual({ ...timed, tolerance: 6, ceiling: 200 });
  });

  it('widens an entry that has no ceiling without giving it one', () => {
    const widened = limitsIn(timedWithoutCeiling, 'ci');
    expect(widened).toStrictEqual({ ...timedWithoutCeiling, tolerance: 6 });
    expect('ceiling' in widened).toBe(false);
  });

  it('widens from a tolerance of one when the entry has none', () => {
    const entry: Baseline = { baseline: 10, ceiling: 20, ciTolerance: 3, unit: 'units' };
    expect(limitsIn(entry, 'ci')).toStrictEqual({ ...entry, tolerance: 3, ceiling: 60 });
  });

  it.each([counter, bareCounter])(
    'returns counter %#, which has no ciTolerance, unchanged in the CI regime',
    (entry) => {
      expect(limitsIn(entry, 'ci')).toBe(entry);
    },
  );

  it.each([timed, timedWithoutCeiling, counter, bareCounter])(
    'removes no field of entry %# in the CI regime',
    (entry) => {
      const widened = limitsIn(entry, 'ci');
      for (const field of Object.keys(entry)) {
        expect(field in widened).toBe(true);
      }
      expect(widened.baseline).toBe(entry.baseline);
      expect(widened.unit).toBe(entry.unit);
      expect(widened.ciTolerance).toBe(entry.ciTolerance);
    },
  );
});

describe('compareInRegime', () => {
  it('fails a reading three times the baseline strictly and passes it in CI', () => {
    const reading = timed.baseline * 3;
    const strict = compareInRegime('parse', reading, timed, 'strict');
    expect(strict.failed).toBe(true);
    expect(strict.limit).toBeCloseTo(timed.baseline * 1.5, 9);
    const ci = compareInRegime('parse', reading, timed, 'ci');
    expect(ci.failed).toBe(false);
    expect(ci.limit).toBeCloseTo(timed.baseline * 6, 9);
  });

  it('passes in CI a reading past the strict budget and inside both CI limits', () => {
    const reading = timed.baseline * 4;
    expect(reading).toBeGreaterThan(50);
    expect(compareInRegime('parse', reading, timed, 'strict').failed).toBe(true);
    expect(compareInRegime('parse', reading, timed, 'ci').failed).toBe(false);
  });

  it('fails a reading ten times the baseline in both regimes', () => {
    const reading = timed.baseline * 10;
    expect(compareInRegime('parse', reading, timed, 'strict').failed).toBe(true);
    expect(compareInRegime('parse', reading, timed, 'ci').failed).toBe(true);
  });

  it.each([timed.baseline, timed.baseline * 0.5])(
    'passes a reading of %d, at or under the baseline, in both regimes',
    (reading) => {
      expect(compareInRegime('parse', reading, timed, 'strict').failed).toBe(false);
      expect(compareInRegime('parse', reading, timed, 'ci').failed).toBe(false);
    },
  );

  it('begins every message with the regime the reading was held to', () => {
    for (const regime of regimes) {
      for (const factor of [0.5, 1, 3, 4, 10]) {
        const { message } = compareInRegime('parse', timed.baseline * factor, timed, regime);
        expect(message.startsWith(`[${regime} regime] parse `)).toBe(true);
      }
    }
  });

  it('says the same thing as compareWithBaseline under the limits of the regime', () => {
    for (const regime of regimes) {
      const direct = compareWithBaseline('parse', 60, limitsIn(timed, regime));
      expect(compareInRegime('parse', 60, timed, regime)).toStrictEqual({
        ...direct,
        message: `[${regime} regime] ${direct.message}`,
      });
    }
  });
});

describe('compareWithBaseline, on a reading at or past a limit', () => {
  it('fails a reading over the ceiling that the tolerance alone would allow', () => {
    const lenient: Baseline = { ...timed, tolerance: 10 };
    const verdict = compareWithBaseline('parse', 60, lenient);
    expect(verdict.failed).toBe(true);
    expect(verdict.limit).toBe(50);
    expect(verdict.message).toContain('past the budget of 50');
  });

  it('gives the ceiling as the reason when a reading is over both limits', () => {
    const verdict = compareWithBaseline('parse', 60, timed);
    expect(verdict.failed).toBe(true);
    expect(verdict.limit).toBe(50);
    expect(verdict.message).toContain('past the budget of 50');
    expect(verdict.message).not.toContain('regressed');
  });

  it('passes a reading exactly at its ceiling, and one exactly at its baseline', () => {
    expect(compareWithBaseline('count', 120, { ...counter, tolerance: 2 }).failed).toBe(false);
    expect(compareWithBaseline('count', 100, counter).failed).toBe(false);
  });

  it('fails a reading over the tolerance and under the ceiling as a regression', () => {
    const verdict = compareWithBaseline('parse', 30, timed);
    expect(verdict.failed).toBe(true);
    expect(verdict.limit).toBeCloseTo(timed.baseline * 1.5, 9);
    expect(verdict.message).toContain('regressed to 30 microseconds from a baseline of 14.579');
    expect(verdict.message).not.toContain('budget');
  });

  it('holds a counter to its baseline exactly', () => {
    const verdict = compareWithBaseline('count', 100.001, bareCounter);
    expect(verdict.failed).toBe(true);
    expect(verdict.limit).toBe(100);
    expect(verdict.message).toContain('regressed');
  });
});

describe('compareWithBaseline, on a reading inside its limits', () => {
  it('reports a counter more than one per cent better as a baseline to commit', () => {
    const verdict = compareWithBaseline('count', 98.9, bareCounter);
    expect(verdict.failed).toBe(false);
    expect(verdict.message).toContain('improved to 98.9 operations: commit that as the baseline');
    expect(verdict.message).toContain('replacing 100');
  });

  it('does not report a counter one per cent better or less as an improvement', () => {
    for (const reading of [99, 99.5, 100]) {
      const verdict = compareWithBaseline('count', reading, bareCounter);
      expect(verdict.failed).toBe(false);
      expect(verdict.message).not.toContain('improved');
      expect(verdict.message).toContain('against a baseline of 100');
    }
  });

  it('never reports an entry with a tolerance as an improvement', () => {
    const verdict = compareWithBaseline('parse', timed.baseline * 0.5, timed);
    expect(verdict.failed).toBe(false);
    expect(verdict.message).not.toContain('improved');
    expect(verdict.message).toContain('against a baseline of 14.579');
  });
});
