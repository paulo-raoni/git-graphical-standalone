import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(repositoryRoot, 'src');
const outputRoot = join(repositoryRoot, 'dist');

/**
 * Production output drops the source maps and minifies; development output
 * keeps them, which is the default because that is what `npm start` runs.
 */
const production = process.argv.includes('--production');

/**
 * What the two halves of the shell run on, pinned to the Electron in the
 * lockfile: Electron 44.3.0 bundles Chromium 152 and Node 24. Downlevelling
 * further would only hide a syntax error behind a transform that the shell
 * never needed.
 */
const NODE_TARGET = 'node24';
const CHROMIUM_TARGET = 'chrome152';

const shared = {
  bundle: true,
  sourcemap: production ? false : 'linked',
  minify: production,
  logLevel: 'error',
  legalComments: 'none',
};

/**
 * The three bundles.
 *
 * Main and preload are CommonJS: a sandboxed preload script is loaded by
 * Electron's own module system and cannot be an ES module, and keeping main the
 * same shape means both halves of the shell resolve `require('electron')` the
 * same way. Electron itself is external to both — it is provided by the runtime,
 * not by the bundle.
 *
 * The renderer is an immediately invoked function rather than a module, because
 * a `type="module"` script is fetched under cross-origin rules that a document
 * loaded from the file system cannot satisfy. It targets the Chromium that this
 * Electron bundles and must never pull in a Node builtin.
 */
const bundles = [
  {
    entryPoints: [join(sourceRoot, 'app', 'main.ts')],
    outfile: join(outputRoot, 'main.cjs'),
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['electron'],
  },
  {
    entryPoints: [join(sourceRoot, 'preload', 'bridge.ts')],
    outfile: join(outputRoot, 'preload.cjs'),
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['electron'],
  },
  {
    entryPoints: [join(sourceRoot, 'ui', 'renderer.ts')],
    outfile: join(outputRoot, 'renderer.js'),
    platform: 'browser',
    format: 'iife',
    target: CHROMIUM_TARGET,
  },
];

/** Files the renderer loads by name, copied rather than bundled. */
const documents = [
  ['ui/index.html', 'index.html'],
  ['ui/renderer.css', 'renderer.css'],
];

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  await Promise.all(bundles.map((bundle) => build({ ...shared, ...bundle })));
  await Promise.all(
    documents.map(([from, to]) => cp(join(sourceRoot, from), join(outputRoot, to))),
  );
}

try {
  await main();
} catch {
  // esbuild has already written its own formatted diagnostic, pointing at the
  // line. Re-throwing would bury it under this script's stack trace, and a gate
  // whose failure is unreadable is a gate people learn to ignore.
  process.exitCode = 1;
}
