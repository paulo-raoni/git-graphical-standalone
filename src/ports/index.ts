/**
 * The ports: what `core/` and `app/` need from the world, as interfaces.
 *
 * The single import surface of the ring, for the same reason
 * `src/core/store/index.ts` is one: a consumer names the ring, not the file
 * inside it, so a module can be split without a change at every call site.
 */
export type {
  PageRequest,
  ReaderDescription,
  RepositoryPage,
  RepositoryReader,
} from './repository-reader';
