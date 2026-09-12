import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Real git repositories, generated from committed data, with the same object
 * names on every machine.
 *
 * The repositories themselves are **not** committed: a repository inside a
 * repository is a submodule waiting to happen, and the interesting part is the
 * recipe, not the bytes. `specification.json` beside this file is the recipe.
 *
 * A commit's object name hashes its tree, its parents, both identities, both
 * timestamps and its message. Leave any of those to the machine and the fixture
 * differs on the next one, so nothing here is inherited: the environment is
 * built from a short list of variables an operating system needs to start a
 * process at all, every git variable is set explicitly, the system and global
 * configuration are switched off rather than merely overridden, and `HOME`
 * points inside the fixture directory so that a profile `.gitconfig` cannot be
 * read even by a code path that ignores the rest.
 */

export interface FixtureIdentity {
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
}

export interface FixtureRepository {
  readonly name: string;
  readonly shape: string;
  readonly commits: number;
}

export interface FixtureSpecification {
  readonly identity: FixtureIdentity;
  readonly firstSecond: number;
  readonly stepSeconds: number;
  readonly zone: string;
  readonly repositories: readonly FixtureRepository[];
}

interface Clock {
  seconds: number;
  readonly step: number;
  readonly zone: string;
}

/** The only variables inherited: enough to start git, nothing that identifies. */
const INHERITED = ['PATH', 'Path', 'SystemRoot', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'];

/**
 * Configuration passed on the command line, which outranks every file.
 *
 * `core.autocrlf` and `core.eol` matter more than they look: a checkout that
 * rewrites line endings writes a different blob, and a different blob is a
 * different tree and a different commit object name.
 */
const CONFIGURATION = [
  'init.defaultBranch=main',
  'core.autocrlf=false',
  'core.eol=lf',
  'core.symlinks=false',
  'core.fsmonitor=false',
  'core.hooksPath=',
  'commit.gpgsign=false',
  'tag.gpgsign=false',
  'gc.auto=0',
  'advice.detachedHead=false',
];

function stampOf(clock: Clock): string {
  return `${String(clock.seconds)} ${clock.zone}`;
}

/** The current stamp, then advance the clock past it. */
function takeStamp(clock: Clock): string {
  const stamp = stampOf(clock);
  clock.seconds += clock.step;
  return stamp;
}

function environmentFor(identity: FixtureIdentity, stamp: string, home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of INHERITED) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  environment['HOME'] = home;
  environment['USERPROFILE'] = home;
  environment['XDG_CONFIG_HOME'] = home;
  environment['GIT_CONFIG_NOSYSTEM'] = '1';
  environment['GIT_CONFIG_GLOBAL'] = join(home, 'no-such-gitconfig');
  environment['GIT_ATTR_NOSYSTEM'] = '1';
  environment['GIT_TERMINAL_PROMPT'] = '0';
  environment['TZ'] = 'UTC';
  environment['LC_ALL'] = 'C';
  environment['GIT_AUTHOR_NAME'] = identity.authorName;
  environment['GIT_AUTHOR_EMAIL'] = identity.authorEmail;
  environment['GIT_AUTHOR_DATE'] = stamp;
  environment['GIT_COMMITTER_NAME'] = identity.committerName;
  environment['GIT_COMMITTER_EMAIL'] = identity.committerEmail;
  environment['GIT_COMMITTER_DATE'] = stamp;
  return environment;
}

/** One repository being built: where it is, who writes it, and what time it is. */
interface Workspace {
  readonly directory: string;
  readonly identity: FixtureIdentity;
  readonly clock: Clock;
}

/** Run git without creating an object, so the clock does not move. */
function git(workspace: Workspace, args: readonly string[], input?: string): string {
  const environment = environmentFor(
    workspace.identity,
    stampOf(workspace.clock),
    workspace.directory,
  );
  const configured = CONFIGURATION.flatMap((setting) => ['-c', setting]);
  return execFileSync('git', [...configured, ...args], {
    cwd: workspace.directory,
    env: environment,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
}

/** Run git to create an object, consuming this commit's slot on the clock. */
function gitAt(workspace: Workspace, args: readonly string[]): string {
  const environment = environmentFor(
    workspace.identity,
    takeStamp(workspace.clock),
    workspace.directory,
  );
  const configured = CONFIGURATION.flatMap((setting) => ['-c', setting]);
  return execFileSync('git', [...configured, ...args], {
    cwd: workspace.directory,
    env: environment,
    encoding: 'utf8',
  });
}

function writeFile(workspace: Workspace, name: string, content: string): void {
  writeFileSync(join(workspace.directory, name), content);
}

function commitFile(workspace: Workspace, name: string, content: string, message: string): void {
  writeFile(workspace, name, content);
  git(workspace, ['add', '--', name]);
  gitAt(workspace, ['commit', '-m', message]);
}

function linearCommits(workspace: Workspace, count: number, file = 'file.txt'): void {
  for (let commit = 1; commit <= count; commit += 1) {
    commitFile(workspace, file, `line ${String(commit)}\n`, `commit ${String(commit)}`);
  }
}

function branchAndMerge(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  git(workspace, ['switch', '--quiet', '--create', 'feature']);
  commitFile(workspace, 'feature.txt', 'feature\n', 'add the feature');
  git(workspace, ['switch', '--quiet', 'main']);
  commitFile(workspace, 'main.txt', 'main\n', 'move main on');
  gitAt(workspace, ['merge', '--no-ff', '-m', 'merge the feature', 'feature']);
}

function twoRoots(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  git(workspace, ['switch', '--quiet', '--orphan', 'second-root']);
  commitFile(workspace, 'second.txt', 'second root\n', 'begin a second history');
  git(workspace, ['switch', '--quiet', 'main']);
  gitAt(workspace, [
    'merge',
    '--no-ff',
    '--allow-unrelated-histories',
    '-m',
    'join the two histories',
    'second-root',
  ]);
}

function tags(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  git(workspace, ['tag', 'lightweight', 'HEAD~1']);
  gitAt(workspace, ['tag', '--annotate', '--message', 'a described release', 'annotated']);
}

function stash(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  writeFile(workspace, 'file.txt', 'work in progress\n');
  gitAt(workspace, ['stash', 'push', '--message', 'work in progress']);
}

function detachedHead(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  git(workspace, ['checkout', '--quiet', '--detach', 'HEAD~1']);
}

function dirtyWorkingTree(workspace: Workspace, count: number): void {
  linearCommits(workspace, count);
  writeFile(workspace, 'file.txt', 'edited but not committed\n');
  writeFile(workspace, 'untracked.txt', 'never added\n');
}

/**
 * A repository of many commits, written through `fast-import`.
 *
 * Ten thousand `git commit` invocations are ten thousand processes and several
 * minutes. `fast-import` is one process and one stream, and because every
 * identity, stamp and blob in that stream is spelled out, the object names are
 * the same ones the slow way would have produced.
 */
function largeHistory(workspace: Workspace, count: number): void {
  const stream: string[] = [];
  for (let commit = 1; commit <= count; commit += 1) {
    const stamp = takeStamp(workspace.clock);
    const message = `commit ${String(commit)}\n`;
    const content = `line ${String(commit)}\n`;
    stream.push(
      'commit refs/heads/main\n',
      `mark :${String(commit)}\n`,
      `author ${workspace.identity.authorName} <${workspace.identity.authorEmail}> ${stamp}\n`,
      `committer ${workspace.identity.committerName} <${workspace.identity.committerEmail}> ${stamp}\n`,
      `data ${String(Buffer.byteLength(message))}\n${message}`,
      commit === 1 ? '' : `from :${String(commit - 1)}\n`,
      `M 644 inline file.txt\ndata ${String(Buffer.byteLength(content))}\n${content}`,
      '\n',
    );
  }
  stream.push('done\n');
  git(workspace, ['fast-import', '--done', '--quiet'], stream.join(''));
  git(workspace, ['reset', '--quiet', '--hard', 'main']);
}

const SHAPES = new Map<string, (workspace: Workspace, count: number) => void>([
  ['linear', linearCommits],
  ['branch-and-merge', branchAndMerge],
  ['two-roots', twoRoots],
  ['tags', tags],
  ['stash', stash],
  ['detached-head', detachedHead],
  ['dirty-working-tree', dirtyWorkingTree],
  ['large', largeHistory],
]);

/** Where this generator's own specification lives. */
export function specificationPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'specification.json');
}

export function readSpecification(path: string = specificationPath()): FixtureSpecification {
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureSpecification;
}

/** Build one repository of the specification into `directory`. */
export function generateRepository(
  directory: string,
  repository: FixtureRepository,
  specification: FixtureSpecification,
): void {
  const build = SHAPES.get(repository.shape);
  if (build === undefined) {
    throw new Error(`no fixture shape named "${repository.shape}"`);
  }
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const workspace: Workspace = {
    directory,
    identity: specification.identity,
    clock: {
      seconds: specification.firstSecond,
      step: specification.stepSeconds,
      zone: specification.zone,
    },
  };
  git(workspace, ['init', '--quiet']);
  build(workspace, repository.commits);
}

/** Build every repository of the specification under `root`, and report where. */
export function generateFixtures(
  root: string,
  specification: FixtureSpecification = readSpecification(),
): readonly string[] {
  mkdirSync(root, { recursive: true });
  return specification.repositories.map((repository) => {
    const directory = join(root, repository.name);
    generateRepository(directory, repository, specification);
    return directory;
  });
}

/** The directory the generated repositories live in, which is ignored by git. */
export function defaultFixtureRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'repositories');
}

/** Where the committed object names of a correct generation live. */
export function expectationPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'expected-object-names.json');
}

/**
 * What a generated repository is, in object names.
 *
 * Every reference is listed in full, because a reference pointing somewhere else
 * is exactly the regression this is here to catch. The commits are reduced to a
 * count and a digest instead: the large fixture has ten thousand of them, and a
 * committed list of ten thousand object names would be four hundred kilobytes of
 * diff nobody can read, while a digest over the same list changes if any one of
 * them does.
 */
export interface RepositoryFingerprint {
  readonly refs: readonly string[];
  readonly commitCount: number;
  readonly commitDigest: string;
}

export function fingerprintOf(
  directory: string,
  specification: FixtureSpecification,
): RepositoryFingerprint {
  const workspace: Workspace = {
    directory,
    identity: specification.identity,
    clock: { seconds: specification.firstSecond, step: 0, zone: specification.zone },
  };
  const refs = git(workspace, ['show-ref', '--head', '--dereference'])
    .split('\n')
    .filter((line) => line.length > 0);
  const commits = git(workspace, ['rev-list', '--all', '--reflog'])
    .split('\n')
    .filter((line) => line.length > 0);
  return {
    refs,
    commitCount: commits.length,
    commitDigest: createHash('sha256').update(commits.join('\n')).digest('hex'),
  };
}

/** Fingerprint every repository of the specification, keyed by name. */
export function fingerprintFixtures(
  root: string,
  specification: FixtureSpecification = readSpecification(),
): Record<string, RepositoryFingerprint> {
  const fingerprints: Record<string, RepositoryFingerprint> = {};
  for (const repository of specification.repositories) {
    fingerprints[repository.name] = fingerprintOf(join(root, repository.name), specification);
  }
  return fingerprints;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  const record = process.argv.includes('--record');
  const given = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const root = given ?? defaultFixtureRoot();
  const built = generateFixtures(root);
  process.stdout.write(`generated ${String(built.length)} fixture repositories under ${root}\n`);
  if (record) {
    writeFileSync(expectationPath(), `${JSON.stringify(fingerprintFixtures(root), null, 2)}\n`);
    process.stdout.write(`recorded their object names in ${expectationPath()}\n`);
  }
}
