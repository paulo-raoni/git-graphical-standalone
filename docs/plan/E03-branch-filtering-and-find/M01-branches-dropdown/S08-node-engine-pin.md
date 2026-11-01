# E03-M01-S08 · `engines` names the Node the gates compare under

**Parent:** E03 Branch filtering and find > E03-M01 Branches dropdown > E03-M01-S08 the Node engine pin

## What changed

`package.json`'s `engines.node` went from `">=24.0.0"` to `"24.18.0"`, and the lockfile's copy of it,
`packages[""].engines.node` in `package-lock.json`, went with it. That is the version `NODE_VERSION` names in
`.github/workflows/ci.yml` and the Node that `MEASURED_UNDER` in `perf/allocation.perf.test.ts` records beside
V8 `13.6.233.17-node.50`. Nothing else in either file moved, as measured below. E03-M01-S05 decided the value
and measured the two facts this lane started from; its slice document gives that account.

Every measurement here was taken on 2026-10-24 on the development machine (Windows 11) by this slice's
executor. Another lane and a review of this milestone ran on the machine at the same time; no reading below is a
time that decides anything.

## Why an exact version and not a range

The range admitted every Node the allocation case turns away, and an exact version says what the workflow and
the case already say. A wider range was considered and not taken, on these measurements:

- **The pin warns, it does not stop.** `.npmrc` sets only `save-exact`, and `npm config get engine-strict`
  printed `false` under both Node runtimes on the machine (24.18.0 with npm 11.16.0, 20.19.5 with npm 10.8.2).
- **What a wider range would buy is silence, not a working gate.** The allocation case compares V8 version
  strings, not Node versions. Whether any 24.x other than 24.18.0 ships the same V8 string was not measured
  (no other 24.x is installed on the machine); a range such as `^24.18.0` would stop warning for every later
  24.x whether or not its V8 matches, so it would claim a support no measurement backs.
- **The range was already narrower than it said.** Installing under Node 20.19.5 (below) printed the
  dependencies' own requirements, and the narrowest of them within 24.x is `^24.15.0` (five packages), so a
  24.0 to 24.14 runtime already met warnings under `">=24.0.0"`.
- **The cost of the pin**, measured below: a contributor who turns `engine-strict` on themselves, on any other
  Node, cannot run `npm ci` at all, where the range let a 24.x through. That is a setting this project does not
  make, and the warning they would otherwise get names the version to use.

## The lockfile changed by one line

- `npm install --package-lock-only` under Node 24.18.0 exited 0 (`up to date, audited 535 packages`), and
  `git diff` showed one changed line in `package-lock.json`, its line 32, the root's `engines.node`.
- **The rest is identical.** The line `        "node": ">=24.0.0"` was removed from the base lockfile and the
  line `        "node": "24.18.0"` from the new one, each matched as a whole line (`grep -x`); each occurs
  exactly once in its file (`grep -c` printed 1 for both), so nothing else was removed. `diff` of the two
  remainders printed nothing and exited 0. The same `diff` over the unstripped files printed that one line and
  exited 1, so the comparison is not blind to a change.
- **`npm ci` installs the same tree.** `npm ci` with the base files, then `npm ci` with the new ones, both
  exited 0 with `added 534 packages, and audited 535 packages` and no `EBADENGINE` line. The installed tree,
  listed from `npm query "*"` as one `<location> <name>@<version>` row per package and sorted, was 535 rows
  (the 534 and the root) both times and identical, and `node_modules/.package-lock.json`, npm's own record of
  what it installed, was byte-identical.

## What a person on another Node meets

**At install time, a warning, and the install proceeds.** Measured with Node 20.19.5 and its npm 10.8.2, the
only other Node installed on the machine, running `npm ci` in a scratch copy of `package.json`,
`package-lock.json` and `.npmrc`. npm's output for the root package was:

```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'git-graphical-standalone@0.1.0',
npm warn EBADENGINE   required: { node: '24.18.0' },
npm warn EBADENGINE   current: { node: 'v20.19.5', npm: '10.8.2' }
npm warn EBADENGINE }
```

It was followed by the same block for 82 dependencies whose own `engines` Node 20 does not meet, then
`added 534 packages, and audited 535 packages`, exit 0. On another 24.x only the root block would be expected,
plus any dependency whose floor is above that 24.x; that is an inference from the requirements npm printed, not
a measurement, since no other 24.x was run. E03-M01-S05 measured the same root warning and exit 0 with a
scratch pin of `24.17.0` under 24.18.0.

**With `engine-strict` on, the install is refused.** Measured under Node 24.18.0 against a scratch copy whose
two `engines` lines said `24.17.0`: `npm ci --engine-strict` printed `npm error code EBADENGINE`,
`Not compatible with your version of node/npm: git-graphical-standalone@0.1.0`,
`Required: {"node":"24.17.0"}` and `Actual: {"node":"v24.18.0","npm":"11.16.0"}`, exited 1, and created no
`node_modules`.

**Later, `gates:perf` refuses, in its allocation case, and compares nothing.** Measured under Node 20.19.5 by
running that case alone, `npx --no-install vitest run --config vitest.perf.config.js
perf/allocation.perf.test.ts`, over this lane's `node_modules` (installed under 24.18.0): it printed
`the child ran under V8 11.3.244.8-node.30, Node v20.19.5`, then failed with the case's own message, which
names both runtimes, says that nothing was compared and that the failure says nothing about the product, and
gives the two ways out (run under the runtime the entries belong to, or measure all four entries again and
commit them together); exit 1. The other gates were not run under Node 20, so whether one of them fails first
is not known. Under a 24.x whose V8 string is `13.6.233.17-node.50` the case would compare as usual; whether such
a 24.x exists was not measured.
