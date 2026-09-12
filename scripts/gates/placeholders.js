import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readText, repositoryRoot, report, walkFiles } from './tree.js';

/**
 * `AGENTS.md` §6.7 made mechanical: no note left for later, no stub, no skipped
 * or focused test, no branch left unwritten — anywhere in the **working tree**.
 *
 * Two decisions worth naming.
 *
 * It reads the tree rather than the index, because `git grep` sees tracked files
 * only (`AGENTS.md` §10) and the file that would fail this gate is exactly the
 * file that has not been staged yet.
 *
 * It reads **code and configuration, not prose**. `AGENTS.md`, the decision
 * records and the task and audit files all discuss placeholders by name, and a
 * gate that fails on the contract that defines it is a gate that gets switched
 * off. `docs/ADR-0003-quality-gates-and-ci.md` §2 scopes this one to changed
 * files for the same reason.
 */

const here = dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(join(here, 'placeholder-patterns.json'), 'utf8'));
const patterns = configuration.patterns.map((pattern) => ({
  what: pattern.what,
  text: pattern.fragments.join(''),
}));

function findingsIn(relativePath) {
  const text = readText(repositoryRoot, relativePath);
  if (text === null) {
    return [];
  }
  const found = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of patterns) {
      if (line.includes(pattern.text)) {
        found.push(`${relativePath}:${String(index + 1)} ${pattern.what}: ${line.trim()}`);
      }
    }
  });
  return found;
}

const scanned = walkFiles().filter((relativePath) =>
  configuration.extensions.some((extension) => relativePath.endsWith(extension)),
);

report(
  `placeholders (${String(scanned.length)} files)`,
  scanned.flatMap((relativePath) => findingsIn(relativePath)),
);
