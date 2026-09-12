import { defineConfig } from 'vitest/config';

/**
 * The performance gate.
 *
 * Its own configuration, and its own run, because it is not a unit test and must
 * not be swept into one. It measures counters rather than a stopwatch
 * (`docs/ADR-0003-quality-gates-and-ci.md` decision 4), it builds tens of
 * thousands of commits to do it, and it compares what it finds with
 * `perf/baselines.json`, which is committed and may only move in the improving
 * direction (`AGENTS.md` §11).
 *
 * One file at a time and one thread: a measurement taken while three other
 * workers are building forty thousand commits is a measurement of the machine's
 * scheduler.
 */
export default defineConfig({
  test: {
    include: ['perf/**/*.perf.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
  },
});
