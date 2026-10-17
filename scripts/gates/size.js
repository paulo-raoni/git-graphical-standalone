import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildInto } from '../build.js';
import { repositoryRoot, report } from './tree.js';

/**
 * The distributable's size budget and its module manifest, so that neither what
 * ships nor what is in it drifts unnoticed
 * (`docs/ADR-0003-quality-gates-and-ci.md` §2, gate 11).
 *
 * It measures the **production** build, which it makes itself, into
 * `reports/size/production/`. It used to measure the development build in
 * `dist/`, on the reasoning that unminified is the stricter of the two
 * measurements and needs no second build. **Both halves of that were true and
 * neither is a reason to keep it.** Stricter turned out to mean stricter about
 * comments: measured 2026-09-13, a stand-in renderer that only reads the
 * existing decode API and the flag constants, with no row pool and no canvas,
 * costs 7232 development bytes and 1745 production bytes, so under the old
 * weighing E01-M01-S05 was over a 3072-byte budget before a line of rendering
 * existed, entirely from prose. A gate that prices documentation against a
 * bundle's budget pays an author to delete it, in a project whose discipline is
 * writing it down. Nothing ships the development build, so the budget now weighs
 * the one that does.
 *
 * **What that gives up, and what replaces it.** Review round 11 measured the
 * regression this gate was last used to catch — the unread contract ring
 * returning to both shell bundles — at +4702 development bytes and +76
 * production ones, which a production budget would have passed with room to
 * spare. So the byte count is no longer the instrument that sees a module
 * arriving, and `scripts/gates/module-manifest.json` is: a committed list of
 * which source modules contribute code to each bundle, refused on addition,
 * which catches that regression at zero bytes of drift. The pair is still not
 * complete, and the manifest's own comment says what neither of them sees.
 *
 * A file listed in the budget and missing from the measured directory is a
 * failure. A file in that directory and missing from the budget is a failure
 * too: a new bundle that nobody budgeted is exactly the drift this is here to
 * catch. There is no exemption for source maps any more, because a production
 * build emits none and one appearing there would itself be the drift.
 *
 * It does not read `dist/`, so `gates:build`, `gates:e2e` and `npm start` keep
 * the development build they expect.
 */

const here = dirname(fileURLToPath(import.meta.url));
const budget = JSON.parse(readFileSync(join(here, 'size-budget.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(here, 'module-manifest.json'), 'utf8'));

/** The build this gate weighs, named in its own output so a transcript can be read later. */
const BUILD_MODE = 'production';

/**
 * Where the production build goes: under `reports/`, which is the gate
 * pipeline's own working directory.
 *
 * It is not `dist/`, which belongs to the development build. It is under
 * `reports/` rather than beside `dist/` because `reports/` is already ignored by
 * git, by Prettier, by ESLint and by `scripts/gates/tree.js`, so a new directory
 * there is invisible to every other gate without editing any of their lists. It
 * is emptied at the start of every run and **left on disk afterwards**, so the
 * bytes a failing run reported can be weighed by hand.
 */
const measured = join(repositoryRoot, 'reports', 'size', 'production');

/** How that directory is spelled in a message: relative to the root, one way on every platform. */
const measuredLabel = relative(repositoryRoot, measured).split('\\').join('/');

/**
 * A module's identity: its path relative to the repository root, `/`-separated,
 * compared **exactly** — same characters, same case.
 *
 * esbuild reports each input relative to the working directory, which is the
 * repository root under every npm script but is not guaranteed to be, so the
 * path is resolved and re-based here rather than trusted as it arrives.
 *
 * The comparison is deliberately the strictest one available. A looser rule —
 * folding case, or matching on a basename — would let one entry start excusing
 * modules nobody wrote it for, which is the allow-list-into-blanket failure
 * `mutation-survivors.json`'s `identity` field exists to prevent. **The strict
 * rule fails red:** on Windows the file system is case-insensitive, so importing
 * `../Contracts/index` resolves to the same file and arrives here spelled
 * differently, and the run then reports both an unlisted module and a stale
 * entry rather than quietly matching. That is noisy and correct; the loose rule
 * would be quiet and wrong.
 *
 * A module that cannot be expressed this way — anything outside the repository
 * root, which today means a dependency pulled into a bundle — returns `null` and
 * is refused by name instead of being compared.
 */
function moduleName(reportedPath) {
  const inside = relative(repositoryRoot, resolve(process.cwd(), reportedPath))
    .split('\\')
    .join('/');
  if (inside === '' || inside.startsWith('../') || /^([A-Za-z]:)?\//.test(inside)) {
    return null;
  }
  return inside;
}

function byteFindings() {
  const found = [];
  let total = 0;
  for (const [name, allowed] of Object.entries(budget.files)) {
    const file = join(measured, name);
    if (!existsSync(file)) {
      found.push(
        `${measuredLabel}/${name} is budgeted at ${String(allowed)} bytes and was not built`,
      );
      continue;
    }
    const size = statSync(file).size;
    total += size;
    if (size > allowed) {
      found.push(
        `${measuredLabel}/${name} is ${String(size)} ${BUILD_MODE} bytes, over its budget of ${String(allowed)}`,
      );
    }
  }
  for (const name of readdirSync(measured)) {
    if (budget.files[name] === undefined) {
      found.push(`${measuredLabel}/${name} was built and is in nobody's budget`);
    }
  }
  if (total > budget.total) {
    found.push(
      `${measuredLabel} is ${String(total)} ${BUILD_MODE} bytes, over its total budget of ${String(budget.total)}`,
    );
  }
  process.stdout.write(
    `size: ${BUILD_MODE} build, ${String(total)} of ${String(budget.total)} budgeted bytes, in ${measuredLabel}/\n`,
  );
  return found;
}

/** One bundle against its manifest entry, in both directions. */
function bundleFindings(bundle, listed) {
  const found = [];
  const present = [];
  for (const { path, bytes } of bundle.modules) {
    const name = moduleName(path);
    if (name === null) {
      found.push(
        `${bundle.name} contains ${path}, which is outside this repository: the manifest names modules by their path under the repository root and cannot express this one`,
      );
      continue;
    }
    present.push(name);
    if (!listed.includes(name)) {
      found.push(
        `${bundle.name} contains ${name}, which its manifest entry does not name (${String(bytes)} ${BUILD_MODE} bytes). A module arriving in a bundle is the direction this list refuses: add it in a commit that says why it belongs there.`,
      );
    }
  }
  for (const name of listed) {
    if (!present.includes(name)) {
      found.push(
        `the manifest names ${name} in ${bundle.name} and the build no longer puts it there. This is the improving direction, and the fix is to delete that line: an entry that names nothing protects nothing.`,
      );
    }
  }
  return found;
}

function manifestFindings(built) {
  const found = [];
  const names = built.map(({ name }) => name);
  for (const name of Object.keys(manifest.bundles)) {
    if (!names.includes(name)) {
      found.push(
        `the manifest names a bundle ${name} that the build does not produce: delete its entry, or restore the bundle`,
      );
    }
  }
  for (const bundle of built) {
    const listed = manifest.bundles[bundle.name];
    if (listed === undefined) {
      found.push(`${bundle.name} was built and is in nobody's manifest entry`);
      continue;
    }
    process.stdout.write(
      `size: ${bundle.name} ${String(bundle.bytes)} bytes, ${String(bundle.modules.length)} modules\n`,
    );
    found.push(...bundleFindings(bundle, listed));
  }
  return found;
}

async function findings() {
  let built;
  try {
    built = await buildInto(measured, true);
  } catch {
    // esbuild has written its own diagnostic at the line. Nothing this gate can
    // add to it is worth burying it under.
    return [`the ${BUILD_MODE} build failed, so there was nothing to weigh`];
  }
  return [...byteFindings(), ...manifestFindings(built)];
}

report('size', await findings());
