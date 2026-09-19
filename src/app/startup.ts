import { resolve } from 'node:path';

/**
 * The folder the application was started with, read off the command line.
 *
 * Electron puts the application's own path in `argv` and where it puts it
 * depends on whether the application is packaged: an unpackaged run is
 * `electron <app> <arguments…>` and a packaged one is `<app> <arguments…>`, so
 * the first argument of the user's own is at index 2 in the first case and
 * index 1 in the second. Getting that wrong is invisible in a packaged build
 * and opens `.` as a repository in every development run — which
 * `test/e2e/window.spec.ts` would see, because it launches with `['.']` and
 * requires the empty state.
 *
 * Anything beginning with `-` is a switch — Chromium's, Electron's or Node's —
 * and never a path. The first argument that is not one is the folder, and any
 * after it are ignored: one window opens one repository in this milestone.
 *
 * The path is made absolute here, because `src/contracts/ipc.ts` says
 * `StartupRepository.path` is absolute and because a relative path would
 * otherwise be resolved against whatever directory the utility process happens
 * to have, which is not the one the user typed it in.
 */
export function startupRepositoryPath(argv: readonly string[], packaged: boolean): string | null {
  const given = argv.slice(packaged ? 1 : 2).find((argument) => !argument.startsWith('-'));
  return given === undefined ? null : resolve(given);
}
