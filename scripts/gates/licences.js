import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repositoryRoot, report } from './tree.js';

/**
 * Every installed dependency's licence, against a committed allow-list
 * (`docs/ADR-0003-quality-gates-and-ci.md` §2, gate 12).
 *
 * The repository is public and MIT, so a copyleft dependency arriving
 * transitively has to be caught here rather than by a stranger. **A licence the
 * checker cannot determine is a failure, not a pass**: it comes back as
 * `UNKNOWN`, which is not on the list, and so it fails like any other licence
 * that is not on the list. That is the whole reason this reads the checker's
 * output itself instead of passing it an allow-list and trusting an exit code.
 *
 * A licence that is not permissive but is acceptable for one named package is an
 * **exception**, recorded with its reason in `licence-allow-list.json`, so that
 * allowing one weak-copyleft development tool does not allow the licence for
 * everything.
 */

const here = dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(join(here, 'licence-allow-list.json'), 'utf8'));
const allowed = new Set(configuration.allowed);

const checker = join(
  repositoryRoot,
  'node_modules',
  'license-checker-rseidelsohn',
  'bin',
  'license-checker-rseidelsohn.js',
);

/** `name@version` back to `name`, which is where the `@scope/` prefix bites. */
function packageNameOf(identifier) {
  const at = identifier.lastIndexOf('@');
  return at <= 0 ? identifier : identifier.slice(0, at);
}

function licencesOf(entry) {
  const licences = entry.licenses;
  if (licences === undefined) {
    return ['UNKNOWN'];
  }
  return Array.isArray(licences) ? licences : [licences];
}

function findingsFor(identifier, entry) {
  const name = packageNameOf(identifier);
  const exception = configuration.exceptions[name];
  return licencesOf(entry)
    .filter((licence) => !allowed.has(licence) && exception?.licence !== licence)
    .map((licence) => `${identifier} is under "${licence}", which is not on the allow-list`);
}

const output = execFileSync(
  process.execPath,
  [checker, '--json', '--excludePrivatePackages', '--start', repositoryRoot],
  { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const installed = JSON.parse(output);
const findings = Object.entries(installed).flatMap(([identifier, entry]) =>
  findingsFor(identifier, entry),
);

process.stdout.write(`licences: ${String(Object.keys(installed).length)} packages checked\n`);
report('licences', findings);
