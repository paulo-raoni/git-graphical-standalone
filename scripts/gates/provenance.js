import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readText, repositoryRoot, report, walkFiles } from './tree.js';

/**
 * A weak, mechanical companion to `AGENTS.md` §1, and it says so.
 *
 * What it does: no file name, no committed string and no dependency name refers
 * to the extension's publisher or to its package. That catches the careless
 * cases — a file copied with its header, a link pasted into a comment, a
 * dependency added by name.
 *
 * **What it cannot do, stated plainly because a green gate here is otherwise
 * misread as a clean room:** it cannot tell whether an algorithm, a layout, a
 * selector or a colour was reproduced from that source, because a derivative
 * work does not have to carry its author's name. Substring matching cannot see
 * structure. `AGENTS.md` §7 keeps the real check where it belongs — the
 * reviewer reads the diff against §1 — and this gate exists so that the obvious
 * failure never reaches that reading.
 *
 * A short list of files is exempt, and every one of them is a document whose
 * subject is the rule itself. `provenance-tokens.json` records each exemption
 * with its reason.
 */

const here = dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(join(here, 'provenance-tokens.json'), 'utf8'));
const tokens = configuration.tokens.map((token) => ({
  what: token.what,
  text: token.fragments.join('').toLowerCase(),
}));
const exempt = new Set(configuration.exempt);

function findingsInText(relativePath) {
  const text = readText(repositoryRoot, relativePath);
  if (text === null) {
    return [];
  }
  const lowered = text.toLowerCase();
  return tokens
    .filter(
      (token) => lowered.includes(token.text) || relativePath.toLowerCase().includes(token.text),
    )
    .map((token) => `${relativePath} names ${token.what}`);
}

/**
 * The lockfile by dependency name rather than by substring: it is four hundred
 * kilobytes of base-64 integrity hashes, and any short token will appear inside
 * one of them by chance.
 */
function findingsInLockfile() {
  const lockfile = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'));
  return Object.keys(lockfile.packages ?? {})
    .filter((name) => tokens.some((token) => name.toLowerCase().includes(token.text)))
    .map((name) => `package-lock.json installs "${name}"`);
}

const findings = walkFiles()
  .filter((relativePath) => !exempt.has(relativePath))
  .flatMap((relativePath) => findingsInText(relativePath))
  .concat(findingsInLockfile());

report('provenance', findings);
