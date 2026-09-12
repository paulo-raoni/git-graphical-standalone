import { defineConfig } from 'vitest/config';

/**
 * The second half of the unit gate: the fixture generator's determinism.
 *
 * It is a separate configuration because it is a separate cost. Building the
 * eight fixture repositories spawns git about seventy times, which on Windows is
 * half a minute of process creation, and the mutation gate runs the *other*
 * suite once per mutant. Mixing the two would multiply that half minute by
 * several hundred.
 *
 * No coverage is collected here: this proves a property of generated data, not
 * of `src/`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
