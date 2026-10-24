import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot, report } from './tree.js';

/**
 * Conventional Commits over the range, plus the rule only a human remembers.
 *
 * `AGENTS.md` §9 forbids **AI attribution of any kind**, and says outright that
 * it overrides whatever attribution the tool running an agent adds by default.
 * A rule like that survives exactly as long as the person who remembers it, so
 * it is checked here: every commit message in the range is read for a co-author
 * trailer naming a model, an assistant or an agent, for a "generated with" or
 * "created by" line, for a link to such a tool, and for an emoji, which §9 also
 * forbids.
 *
 * The range is the first argument, else `GATE_COMMIT_RANGE`, else the range
 * `AGENTS.md` §7 says the reviewer reads: from the previous promotion's tag up
 * to `HEAD`. A promotion tag is an annotated tag named `v0.<minor>.<patch>`
 * (§8), and the previous one is found by ancestry, never by name or date: of
 * the promotion tags on commits that are ancestors of `HEAD` and not `HEAD`
 * itself, the one on the commit that every other such commit is an ancestor
 * of. A tag on `HEAD` is skipped so that the commit a promotion tags, read on
 * its own, is checked from the promotion before it, release merge included.
 * With no promotion tag behind `HEAD`, the range is everything reachable from
 * it. Continuous integration passes no range, so it reads this default too.
 */

/** `AGENTS.md` §8's tag name; an annotated tag is also required of it. */
const PROMOTION_TAG = /^v0\.\d+\.\d+$/;

/** Trailers, lines and links that name a tool rather than a person. */
const ATTRIBUTION = [
  {
    what: 'a co-author trailer naming a tool',
    pattern:
      /^\s*co-authored-by:.*\b(ai|agent|assistant|anthropic|claude|copilot|codex|cursor|gemini|gpt|llm|model|openai|bot)\b/im,
  },
  {
    what: 'a "generated with" or "created by" line',
    pattern: /^\s*(generated|created|authored|written)\s+(with|by)\b/im,
  },
  { what: 'a link to an assistant', pattern: /\b(claude\.(ai|com)|openai\.com|copilot)\b/i },
  { what: 'a no-reply address of an assistant', pattern: /noreply@(anthropic|openai)\.com/i },
  { what: 'an emoji', pattern: /\p{Extended_Pictographic}/u },
];

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

/**
 * Every promotion tag on an ancestor of `HEAD` other than `HEAD`, as
 * `{ name, commit }`. `--merged=HEAD` keeps the tags whose commit `HEAD`
 * reaches; `--no-contains=HEAD` drops the ones whose commit reaches `HEAD`,
 * which among those is only a tag on `HEAD` itself. `%(objecttype)` is `tag`
 * for an annotated tag only. `rev-parse` peels each to its commit.
 */
function promotionTagsBehindHead() {
  const names = git([
    'for-each-ref',
    '--merged=HEAD',
    '--no-contains=HEAD',
    '--format=%(objecttype) %(refname:strip=2)',
    'refs/tags',
  ])
    .split('\n')
    .map((line) => line.trim().split(' '))
    .filter(([type, name]) => type === 'tag' && PROMOTION_TAG.test(name ?? ''))
    .map(([, name]) => name ?? '');
  if (names.length === 0) {
    return [];
  }
  const commits = git(['rev-parse', ...names.map((name) => `refs/tags/${name}^{commit}`)])
    .split('\n')
    .map((line) => line.trim());
  return names.map((name, index) => ({ name, commit: commits[index] ?? '' }));
}

/**
 * The previous promotion's tag: `git merge-base --independent` prints the
 * commits that no other of them is an ancestor of, so it prints exactly one
 * when the tags lie on one line of history, as promotions on `main` do. More
 * than one means no tag is the latest by ancestry, and guessing could start the
 * range after commits it has to read, so the gate refuses instead.
 */
function previousPromotion() {
  const tags = promotionTagsBehindHead();
  if (tags.length === 0) {
    return { tag: undefined };
  }
  const latest = git(['merge-base', '--independent', ...tags.map(({ commit }) => commit)])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const named = tags.filter(({ commit }) => latest.includes(commit)).map(({ name }) => name);
  if (latest.length > 1) {
    return { refusal: `no promotion tag is the latest by ancestry: ${named.join(', ')}` };
  }
  // Two tags on one commit name the same range; the first in refname order wins.
  return { tag: named[0] };
}

function range() {
  const given = process.argv[2] ?? process.env['GATE_COMMIT_RANGE'];
  if (given !== undefined && given !== '') {
    const source = process.argv[2] === undefined ? 'GATE_COMMIT_RANGE' : 'the argument';
    return { selected: given, why: `${source} names it` };
  }
  const { tag, refusal } = previousPromotion();
  if (refusal !== undefined) {
    return { refusal: `${refusal}; pass a range as an argument or in GATE_COMMIT_RANGE` };
  }
  if (tag === undefined) {
    return { selected: 'HEAD', why: 'no promotion tag is on an ancestor of HEAD' };
  }
  return { selected: `${tag}..HEAD`, why: `${tag} is the latest promotion tag behind HEAD` };
}

/**
 * Every message in the range, each preceded by its object name.
 *
 * Records are separated by a zero byte, which git writes with `%x00` and which
 * no commit message can contain, so a body with blank lines in it cannot be read
 * as two commits.
 */
function messagesIn(selected) {
  return git(['log', '--format=%H%n%B%x00', selected])
    .split('\u0000')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function attributionFindings(selected) {
  return messagesIn(selected).flatMap((message) => {
    const subject = message.split('\n')[1] ?? '';
    const short = message.slice(0, 8);
    return ATTRIBUTION.filter(({ pattern }) => pattern.test(message)).map(
      ({ what }) => `${short} "${subject}" carries ${what} (AGENTS.md section 9)`,
    );
  });
}

function conventionalFindings(selected) {
  const cli = join(repositoryRoot, 'node_modules', '@commitlint', 'cli', 'lib', 'cli.js');
  if (!existsSync(cli)) {
    return ['commitlint is not installed, so the conventional half of this gate did not run'];
  }
  const [from, to] = selected.includes('..') ? selected.split('..') : [undefined, selected];
  const args = [cli, '--to', to ?? 'HEAD'];
  if (from !== undefined) {
    args.splice(1, 0, '--from', from);
  }
  try {
    execFileSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8' });
    return [];
  } catch (failure) {
    const output = `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}`;
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

const { selected, why, refusal } = range();
if (refusal === undefined) {
  process.stdout.write(`commits: checking ${selected}, because ${why}\n`);
  report('commits', [...conventionalFindings(selected), ...attributionFindings(selected)]);
} else {
  report('commits', [refusal]);
}
