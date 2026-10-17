import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(repositoryRoot, 'src');

/**
 * Where this script's own command line builds to, and the only directory
 * `npm start`, `gates:build` and `gates:e2e` ever look at.
 *
 * It is reachable only from `main` below, which runs when a person or an npm
 * script invokes this file. **A gate that wants a production build calls
 * `buildInto` with a directory of its own**, because `dist/` is what the
 * end-to-end gate drives and what `npm start` launches, and writing a minified
 * bundle over it would change both without saying so.
 */
const commandLineOutputRoot = join(repositoryRoot, 'dist');

/**
 * What the two halves of the shell run on, pinned to the Electron in the
 * lockfile: Electron 44.3.0 bundles Chromium 152 and Node 24. Downlevelling
 * further would only hide a syntax error behind a transform that the shell
 * never needed.
 */
const NODE_TARGET = 'node24';
const CHROMIUM_TARGET = 'chrome152';

/**
 * The four bundles.
 *
 * Main, preload and the repository process are CommonJS: a sandboxed preload
 * script is loaded by Electron's own module system and cannot be an ES module,
 * and keeping the others the same shape means every half of the shell resolves
 * `require` the same way. It also matters for the utility process specifically:
 * `package.json` says `"type": "module"`, which is inherited by every `.js` file
 * under the application directory, so a utility process built as `.js` would be
 * loaded as an ES module by Node and a `.cjs` one is not — the extension is the
 * whole of what decides it. Electron itself is external to all three; it is
 * provided by the runtime, not by the bundle, and the repository process
 * imports none of it.
 *
 * The renderer is an immediately invoked function rather than a module, because
 * a `type="module"` script is fetched under cross-origin rules that a document
 * loaded from the file system cannot satisfy. It targets the Chromium that this
 * Electron bundles and must never pull in a Node builtin.
 */
const bundles = [
  {
    name: 'main.cjs',
    entryPoints: [join(sourceRoot, 'app', 'main.ts')],
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['electron'],
  },
  {
    name: 'repository.cjs',
    entryPoints: [join(sourceRoot, 'app', 'repository-host.ts')],
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['electron'],
  },
  {
    name: 'preload.cjs',
    entryPoints: [join(sourceRoot, 'preload', 'bridge.ts')],
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    external: ['electron'],
  },
  {
    name: 'renderer.js',
    entryPoints: [join(sourceRoot, 'ui', 'renderer.ts')],
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

/**
 * The one output of a bundle that is not its source map.
 *
 * `metafile.outputs` is keyed by path relative to the working directory and
 * holds the map beside the bundle in a development build, so the entry is found
 * by eliminating the map rather than by reconstructing the key.
 */
function bundleOutput(metafile) {
  const entry = Object.entries(metafile.outputs).find(([path]) => !path.endsWith('.map'));
  if (entry === undefined) {
    throw new Error('esbuild produced no output other than a source map');
  }
  return entry[1];
}

/**
 * Build the four bundles and copy the two documents into `outputRoot`, and
 * return what esbuild says it produced.
 *
 * Production output drops the source maps and minifies; development output
 * keeps them, which is the default because that is what `npm start` runs.
 *
 * **The directory is emptied first**, so a caller never measures a file left by
 * an earlier run with different options.
 *
 * The returned `modules` are esbuild's own account of which source files
 * contributed code to each bundle, taken from `metafile` and filtered to those
 * with `bytesInOutput` above zero. The filter is the whole point of the number:
 * `src/contracts/index.ts` is read by both shell entry points and contributes
 * **0** bytes to either, because it is a barrel that only re-exports, so a list
 * of "modules esbuild read" would name it permanently and say nothing. Measured
 * 2026-09-13 on this tree, in both modes. Paths are esbuild's, relative to the
 * working directory; the size gate normalises them, because what counts as the
 * same module is that gate's rule and not this script's.
 */
export async function buildInto(outputRoot, production) {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const shared = {
    bundle: true,
    sourcemap: production ? false : 'linked',
    minify: production,
    logLevel: 'error',
    legalComments: 'none',
    metafile: true,
  };

  const built = await Promise.all(
    bundles.map(async ({ name, ...bundle }) => {
      const result = await build({ ...shared, ...bundle, outfile: join(outputRoot, name) });
      const output = bundleOutput(result.metafile);
      return {
        name,
        bytes: output.bytes,
        modules: Object.entries(output.inputs)
          .filter(([, input]) => input.bytesInOutput > 0)
          .map(([path, input]) => ({ path, bytes: input.bytesInOutput })),
      };
    }),
  );
  await Promise.all(
    documents.map(([from, to]) => cp(join(sourceRoot, from), join(outputRoot, to))),
  );
  return built;
}

/**
 * Run only when this file is the program, so that importing `buildInto` from a
 * gate does not also rebuild `dist/` as a side effect of the import.
 */
const isProgram =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isProgram) {
  try {
    await buildInto(commandLineOutputRoot, process.argv.includes('--production'));
  } catch {
    // esbuild has already written its own formatted diagnostic, pointing at the
    // line. Re-throwing would bury it under this script's stack trace, and a gate
    // whose failure is unreadable is a gate people learn to ignore.
    process.exitCode = 1;
  }
}
