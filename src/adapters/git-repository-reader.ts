import type { Result } from '../contracts/index';
import type {
  PageRequest,
  ReaderDescription,
  RepositoryPage,
  RepositoryReader,
} from '../ports/index';

import { discoverGit } from './git-executable';
import type { DiscoveryOptions, GitExecutable } from './git-executable';
import { readGitPage } from './git-page';

/**
 * The `RepositoryReader` this application actually runs: the git command-line
 * interface, over a pipe.
 *
 * It is the only implementation of the port, and the port is what makes that
 * sentence removable: `core/` never names git, so the parsers are tested without
 * a repository and a second reader — a fake for the renderer's tests, a
 * different mechanism entirely — costs nothing here.
 *
 * Discovery is memoised on success and retried after a failure, because "git is
 * missing" is a state a user fixes while the application is open, and a cached
 * refusal is a restart the user should not need.
 */

/** How to build the reader. Everything is optional and defaults to this process. */
export interface GitReaderOptions {
  /** A git the user configured, tried before `PATH` and the install locations. */
  readonly configuredPath?: string | undefined;
  /** The platform to search as. Defaults to the one this process runs on. */
  readonly platform?: string | undefined;
  /** The environment to search in. Defaults to this process's own. */
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

/** A reader that finds git for itself and reads pages with it. */
export function createGitRepositoryReader(options: GitReaderOptions = {}): RepositoryReader {
  const discovery: DiscoveryOptions = {
    configuredPath: options.configuredPath,
    platform: options.platform ?? process.platform,
    environment: options.environment ?? process.env,
  };
  let pending: Promise<Result<GitExecutable>> | null = null;

  const locate = (): Promise<Result<GitExecutable>> => {
    pending ??= discoverGit(discovery).then((found) => {
      if (!found.ok) {
        pending = null;
      }
      return found;
    });
    return pending;
  };

  return {
    describe: async (): Promise<Result<ReaderDescription>> => {
      const found = await locate();
      if (!found.ok) {
        return found;
      }
      return { ok: true, value: { program: found.value.path, version: found.value.version.text } };
    },
    readPage: async (request: PageRequest): Promise<Result<RepositoryPage>> => {
      const found = await locate();
      if (!found.ok) {
        return found;
      }
      return readGitPage(found.value.path, request);
    },
  };
}
