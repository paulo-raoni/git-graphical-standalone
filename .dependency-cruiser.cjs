/**
 * The dependency rule of `docs/ADR-0002-architecture-and-performance.md`
 * decision 1, written so that a machine enforces it.
 *
 * Dependencies point inward only:
 *
 *   contracts  <-  ports  <-  core  <-  adapters  <-  app
 *   contracts  <-  ui
 *
 * A convention that is only written down erodes in the third lane. Every rule
 * below is an error, not a warning, so `npm run gates:boundaries` is the whole
 * of the rule and there is nowhere else to look.
 */

/** Entry points: by definition nothing imports them, so they are not orphans. */
const ENTRY_POINTS = '^src/(app/main|preload/bridge|ui/renderer)\\.ts$';

/** The rings that may not reach the platform. */
const PURE_RINGS = '^src/(core|ports)/';

/** The rings that only the composition root may know about. */
const OUTER_RINGS = '^src/(adapters|app|preload|ui)/';

module.exports = {
  forbidden: [
    {
      name: 'contracts-depends-on-nothing',
      severity: 'error',
      comment:
        'src/contracts/ is the shared vocabulary. It imports nothing at all, which is what lets ' +
        'three lanes of one wave depend on it without depending on each other.',
      from: { path: '^src/contracts/' },
      to: { pathNot: '^src/contracts/' },
    },
    {
      name: 'core-and-ports-no-electron',
      severity: 'error',
      comment:
        'src/core/ and src/ports/ are pure. Reaching for the shell is what this gate exists to stop.',
      from: { path: PURE_RINGS },
      to: { path: 'node_modules/electron' },
    },
    {
      name: 'core-and-ports-no-node-builtins',
      severity: 'error',
      comment:
        'src/core/ and src/ports/ do no I/O. What they need from the world arrives as a port, ' +
        'passed in by the composition root.',
      from: { path: PURE_RINGS },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-and-ports-no-outer-rings',
      severity: 'error',
      comment: 'Dependencies point inward. The inner rings know nothing of the outer ones.',
      from: { path: PURE_RINGS },
      to: { path: OUTER_RINGS },
    },
    {
      name: 'core-only-inward',
      severity: 'error',
      comment: 'src/core/ may import src/contracts/ and src/ports/, and nothing else.',
      from: { path: '^src/core/' },
      to: { pathNot: '^src/(contracts|core|ports)/' },
    },
    {
      name: 'ports-only-contracts',
      severity: 'error',
      comment:
        'src/ports/ is the vocabulary of what core needs from the world. It is interfaces over ' +
        'contract types, and nothing else.',
      from: { path: '^src/ports/' },
      to: { pathNot: '^src/(contracts|ports)/' },
    },
    {
      name: 'adapters-no-outer-rings',
      severity: 'error',
      comment:
        'src/adapters/ implements ports. It may use src/contracts/, src/ports/ and src/core/, ' +
        'but it never reaches back out to the shell, the bridge or the view.',
      from: { path: '^src/adapters/' },
      to: { path: '^src/(app|preload|ui)/' },
    },
    {
      name: 'ui-no-electron',
      severity: 'error',
      comment:
        'The renderer is sandboxed and has no Node integration. It talks through the preload ' +
        'bridge or not at all.',
      from: { path: '^src/ui/' },
      to: { path: 'node_modules/electron' },
    },
    {
      name: 'ui-no-node-builtins',
      severity: 'error',
      comment: 'The renderer runs in a sandbox where Node builtins do not exist.',
      from: { path: '^src/ui/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'ui-only-contracts',
      severity: 'error',
      comment:
        'src/ui/ holds no rule. It renders what it is given and may name only the shared ' +
        'vocabulary; a question like "which lane is this commit in" is never answered here.',
      from: { path: '^src/ui/' },
      to: { pathNot: '^src/(contracts|ui)/' },
    },
    {
      name: 'app-is-private',
      severity: 'error',
      comment:
        'src/app/ is the composition root. It is reached only as the build entry point, never by ' +
        'an import from another ring.',
      from: { path: '^src/', pathNot: '^src/app/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means two modules are one module that has not admitted it, and it defeats every ' +
        'ring rule above by making the direction unanswerable.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'A module nobody imports and that imports nothing is dead weight that still passes every ' +
        'other gate.',
      from: { orphan: true, pathNot: ENTRY_POINTS },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'An import that does not resolve makes every rule above unenforceable for that edge.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    /**
     * node_modules stays in the graph as leaf nodes, so that a rule can forbid
     * `electron` by path. Following into it would be slow and would add
     * thousands of modules nothing here has an opinion about.
     */
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      mainFields: ['module', 'main'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
