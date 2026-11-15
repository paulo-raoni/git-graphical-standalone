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
  /** The steps a repository is built from in place of a shape's code, by its name. */
  readonly scripts?: Readonly<Record<string, readonly FixtureStep[]>>;
}

/**
 * One step of a repository the specification spells out: git run with `args`,
 * reading `input`'s lines on its standard input, each ended by a line feed.
 */
export type FixtureStep = { readonly args: readonly string[]; readonly input?: readonly string[] };

type Clock = { seconds: number; readonly step: number; readonly zone: string };

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
export function takeStamp(clock: Clock): string {
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
export interface Workspace {
  readonly directory: string;
  readonly identity: FixtureIdentity;
  readonly clock: Clock;
}

/** Run git in the workspace with every identity and stamp set to `stamp`. */
function gitStamped(
  workspace: Workspace,
  stamp: string,
  args: readonly string[],
  input?: string,
): string {
  const environment = environmentFor(workspace.identity, stamp, workspace.directory);
  const configured = CONFIGURATION.flatMap((setting) => ['-c', setting]);
  return execFileSync('git', [...configured, ...args], {
    cwd: workspace.directory,
    env: environment,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
}

/** Run git without creating an object, so the clock does not move. */
export function git(workspace: Workspace, args: readonly string[], input?: string): string {
  return gitStamped(workspace, stampOf(workspace.clock), args, input);
}

/** Run git to create an object, consuming this commit's slot on the clock. */
export function gitAt(workspace: Workspace, args: readonly string[]): string {
  return gitStamped(workspace, takeStamp(workspace.clock), args);
}

export function writeFile(workspace: Workspace, name: string, content: string): void {
  writeFileSync(join(workspace.directory, name), content);
}

function commitFile(workspace: Workspace, name: string, content: string, message: string): void {
  writeFile(workspace, name, content);
  git(workspace, ['add', '--', name]);
  gitAt(workspace, ['commit', '-m', message]);
}

export function linearCommits(workspace: Workspace, count: number, file = 'file.txt'): void {
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

/** The branches `remotes` cuts from the trunk: name, how far below `main`, how many commits. */
const BRANCHED_OFF = ['only-remote 8 2', 'feature 5 3', 'topic 3 2'];

/**
 * Remote-tracking branches beside several local ones: the shape a branch
 * selection is read from.
 *
 * `count` commits of trunk on `main`, written as `largeHistory` writes them so
 * that a trunk long enough for a selected branch to need a Load More costs one
 * process. Then, each cut near the trunk's end and each committed to a file of
 * its own by `linearCommits`:
 * `origin/only-remote`, two commits that a remote-tracking branch reaches and
 * no local branch does; `feature`, three commits, with `origin/feature` one
 * behind it; and `topic`, two commits, merged into `main` by a merge commit that
 * `origin/main` does not have yet. `release` is a local branch inside the
 * trunk, `refs/remotes/origin/HEAD` names `origin/main`, the lightweight tag
 * `light` and the annotated tag `annotated` sit on the trunk, and `main` is
 * checked out with a modified file and an untracked one, as `dirtyWorkingTree`
 * leaves it, so the uncommitted row has something to show.
 *
 * The remote-tracking refs are written with `update-ref`, which is all a fetch
 * leaves behind that a page reads: no remote is configured, because nothing
 * here asks git about one. `only-remote` is a local branch only while it is
 * built, and is deleted in the same transaction that gives its commits to
 * `origin/only-remote`.
 */
function remotes(workspace: Workspace, count: number): void {
  largeHistory(workspace, count);
  git(workspace, ['branch', 'release', 'main~30']);
  git(workspace, ['tag', 'light', 'main~20']);
  gitAt(workspace, ['tag', '--annotate', '-m', 'a described release', 'annotated', 'main~1']);
  for (const branch of BRANCHED_OFF) {
    const [name = '', back = '', commits = ''] = branch.split(' ');
    git(workspace, ['switch', '--quiet', '--create', name, `main~${back}`]);
    linearCommits(workspace, Number(commits), `${name}.txt`);
  }
  git(workspace, ['switch', '--quiet', 'main']);
  gitAt(workspace, ['merge', '--quiet', '--no-ff', '-m', 'merge the topic', 'topic']);
  const origin = 'update refs/remotes/origin/';
  const moves = `${origin}main main^1\n${origin}feature feature~1\n${origin}only-remote only-remote\n`;
  git(workspace, ['update-ref', '--stdin'], `${moves}delete refs/heads/only-remote\n`);
  git(workspace, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  dirtyWorkingTree(workspace, 0);
}

/**
 * A repository the specification spells out as git commands, one after another,
 * rather than as code here: a repository whose name `specification.json`'s
 * `scripts` holds steps for is built from them, whatever its shape says, and
 * names the shape `script` to say so. The `details` repository is one: a
 * `fast-import` stream that writes every name, identity, date and message exactly
 * as they are spelt there, then its working tree's changes, restored from a commit
 * of that stream whose reference is deleted once they are. The stream is run with
 * `core.protectNTFS` off because the history holds `quote"mark.txt` and
 * `question?.txt`, names Windows refuses: with it on, git 2.51.0 on Windows
 * refused the first as an invalid path (measured by E04-M01-S06), and with it off
 * it writes both into the history, and checking out a tree without them writes
 * them into no working tree. No clock is read, so `firstSecond` moves none of its
 * object names.
 *
 * The `stashes` repository is another (E04-M01-S14): the shape the reference
 * extension was observed with, two stashes and an uncommitted change. Its stream
 * writes `main`'s two commits, *commit 1* and *move main on*; *on gone*, a commit
 * no branch reaches, which stands for a branch deleted after a stash was made on
 * it; and each stash's commits as `git stash` makes them: the stash, whose first
 * parent is the commit it was made on and whose second is a commit of the index
 * on that commit, and for `stash@{0}` a third, a commit with no parent holding
 * the untracked `untracked.txt`. `git stash store` then puts the two in the stash
 * list, oldest first, so `stash@{0}` is the one on *move main on*. They are
 * written rather than made with `git stash push` because a step reads no clock,
 * and every commit here needs a second of its own for the rows to fall by date as
 * they were observed: `stash@{0}`, *move main on*, `stash@{1}`, *on gone*,
 * *commit 1*. `git stash store` refuses a commit that is not shaped like a stash
 * (git 2.51.0, measured by E04-M01-S14), and these it took.
 */
function scripted(steps: readonly FixtureStep[]): (workspace: Workspace, count: number) => void {
  return (workspace) => {
    for (const step of steps) {
      git(workspace, step.args, step.input?.map((line) => `${line}\n`).join(''));
    }
  };
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
  ['remotes', remotes],
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
  const steps = specification.scripts?.[repository.name];
  const build = steps === undefined ? SHAPES.get(repository.shape) : scripted(steps);
  if (build === undefined) {
    throw new Error(`no fixture shape named "${repository.shape}"`);
  }
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const workspace = workspaceOf(directory, specification, specification.stepSeconds);
  git(workspace, ['init', '--quiet']);
  build(workspace, repository.commits);
}

/** A workspace on `directory`, its clock at the specification's first second and moving by `step`. */
function workspaceOf(directory: string, spec: FixtureSpecification, step: number): Workspace {
  return {
    directory,
    identity: spec.identity,
    clock: { seconds: spec.firstSecond, step, zone: spec.zone },
  };
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
  const workspace = workspaceOf(directory, specification, 0);
  const linesOf = (text: string): string[] => text.split('\n').filter((line) => line.length > 0);
  const refs = linesOf(git(workspace, ['show-ref', '--head', '--dereference']));
  const commits = linesOf(git(workspace, ['rev-list', '--all', '--reflog']));
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
