import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repositoryRoot, report } from './tree.js';

/**
 * The distributable's size budget, so that it does not drift upward unnoticed
 * (`docs/ADR-0003-quality-gates-and-ci.md` §2, gate 11).
 *
 * It measures the **development** build, which is what `gates:build` has already
 * produced by the time this runs: unminified, so it is the stricter of the two
 * measurements and needs no second build. Source maps are left out because a
 * production build has none and nothing ships them.
 *
 * A file listed in the budget and missing from `dist/` is a failure. A file in
 * `dist/` and missing from the budget is a failure too: a new bundle that nobody
 * budgeted is exactly the drift this is here to catch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const budget = JSON.parse(readFileSync(join(here, 'size-budget.json'), 'utf8'));
const distribution = join(repositoryRoot, 'dist');

function findings() {
  if (!existsSync(distribution)) {
    return ['dist/ does not exist: run `npm run build` before the size gate'];
  }
  const found = [];
  let total = 0;
  for (const [name, allowed] of Object.entries(budget.files)) {
    const file = join(distribution, name);
    if (!existsSync(file)) {
      found.push(`dist/${name} is budgeted at ${String(allowed)} bytes and was not built`);
      continue;
    }
    const size = statSync(file).size;
    total += size;
    if (size > allowed) {
      found.push(`dist/${name} is ${String(size)} bytes, over its budget of ${String(allowed)}`);
    }
  }
  for (const name of readdirSync(distribution)) {
    if (!name.endsWith('.map') && budget.files[name] === undefined) {
      found.push(`dist/${name} was built and is in nobody's budget`);
    }
  }
  if (total > budget.total) {
    found.push(`dist/ is ${String(total)} bytes, over its total budget of ${String(budget.total)}`);
  }
  process.stdout.write(`size: ${String(total)} of ${String(budget.total)} budgeted bytes\n`);
  return found;
}

report('size', findings());
