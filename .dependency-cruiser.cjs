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

/**
 * Entry points: by definition nothing imports them, so they are not orphans.
 *
 * There are four, one per bundle `scripts/build.js` makes. `app/repository-host`
 * is the utility process of
 * `docs/ADR-0002-architecture-and-performance.md` decision 2: it is started by
 * the main process by path, never imported, so without a line here the rule
 * against dead modules would refuse it.
 */
const ENTRY_POINTS = '^src/(app/main|app/repository-host|preload/bridge|ui/renderer)\\.ts$';

/** The rings that may not reach the platform. */
const PURE_RINGS = '^src/(core|ports)/';

/** The rings that only the composition root may know about. */
const OUTER_RINGS = '^src/(adapters|app|preload|ui)/';

/**
 * Colocated unit tests. They live inside their ring and are bound by its rules,
 * with one addition that product code does not get: they name the test runner.
 */
const TEST_FILES = '\\.test\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'contracts-depends-on-nothing',
      severity: 'error',
      comment:
        'src/contracts/ is the shared vocabulary. It imports nothing at all, which is what lets ' +
        'three lanes of one wave depend on it without depending on each other.',
      from: { path: '^src/contracts/', pathNot: TEST_FILES },
      to: { pathNot: '^src/contracts/' },
    },
    {
      name: 'contracts-tests-only-the-runner',
      severity: 'error',
      comment:
        'A colocated test of src/contracts/ obeys its ring and names one thing besides: the test ' +
        'runner. The rule above excludes test files rather than widening itself, because widening ' +
        'it would let the contract code itself reach vitest — and then the ring that imports ' +
        'nothing would import whatever a file happens to name. The ring imports nothing; its ' +
        'tests import the runner and nothing else, so a contracts test that names another ' +
        'package, another ring or a Node builtin still fails here.',
      from: { path: '^src/contracts/.*\\.test\\.ts$' },
      to: { pathNot: '^src/contracts/|^node_modules/vitest/' },
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
      from: { path: '^src/core/', pathNot: TEST_FILES },
      to: { pathNot: '^src/(contracts|core|ports)/' },
    },
    {
      name: 'core-tests-only-inward-and-the-runner',
      severity: 'error',
      comment:
        'A colocated test of src/core/ obeys its ring and names one thing besides: the test ' +
        'runner. The rule above excludes test files rather than widening itself, because ' +
        'widening it would let the product code reach vitest as well — and the rule against ' +
        'Node builtins still covers these files, so a core test that opens a file still fails.',
      from: { path: '^src/core/.*\\.test\\.ts$' },
      to: { pathNot: '^src/(contracts|core|ports)/|^node_modules/vitest/' },
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
      name: 'preload-only-contracts',
      severity: 'error',
      comment:
        'src/preload/ is the one surface the renderer has on the rest of the application. It ' +
        'carries contract types across a process boundary and nothing else, so it names ' +
        'src/contracts/ and electron and no other ring; a bridge that reached into core/ would ' +
        'widen that surface without anything saying so. Until this rule existed the ring table ' +
        'in the slice document was the only place it was written, and a rule that is only ' +
        'written down erodes.',
      from: { path: '^src/preload/' },
      to: { path: '^src/(adapters|app|core|ports|ui)/' },
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
      from: { path: '^src/ui/', pathNot: TEST_FILES },
      to: { pathNot: '^src/(contracts|ui)/' },
    },
    {
      name: 'ui-tests-only-the-runner',
      severity: 'error',
      comment:
        'A colocated test of src/ui/ obeys its ring and names one thing besides: the test ' +
        'runner. The rule above excludes test files rather than widening itself, for the reason ' +
        'its two predecessors give: widening it would let the renderer itself reach vitest, and ' +
        'then the ring that may name only the contract would name whatever a file happens to. ' +
        'Until E01-M01-S06 there was no such pair here at all, so S05 could not colocate a ' +
        'single test and its pure arithmetic had to be tested from test/e2e/ on the slowest ' +
        'runner in the project, outside the coverage report. The two rules against Electron and ' +
        'against Node builtins still cover these files, so a renderer test that opens a file ' +
        'still fails.',
      from: { path: '^src/ui/.*\\.test\\.ts$' },
      to: { pathNot: '^src/(contracts|ui)/|^node_modules/vitest/' },
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
