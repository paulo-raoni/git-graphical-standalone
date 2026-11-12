import type { ChangedFile } from '../../contracts/index';

/**
 * Where a file listed in a commit's details is now, by the diff of that commit
 * against the working tree's tracked files (E04-M01-S10, *Open File following
 * renames*).
 *
 * `changes` is that diff, read with the same options as the details read
 * (`uncommittedDiffArgs` of `src/adapters/git-commands.ts`) and parsed by the
 * changed-files parser. The rule is the whole of what a rename or a deletion
 * since the commit means for a path:
 *
 * - a `renamed` entry whose old path is `path` gives that entry's path;
 * - a `deleted` entry whose path is `path` means the file is gone: `null`;
 * - anything else leaves the path as it is.
 *
 * A rename the working tree holds only as a deletion and an untracked file is
 * not a rename to this diff, which compares tracked files alone, so the path
 * comes back as `null` (deleted) and the caller says the file is not in the
 * working tree.
 */
export function currentPathOf(changes: readonly ChangedFile[], path: string): string | null {
  for (const change of changes) {
    if (change.status === 'renamed' && change.oldPath === path) {
      return change.path;
    }
    if (change.status === 'deleted' && change.path === path) {
      return null;
    }
  }
  return path;
}
