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
 * The range defaults to the previous promotion's tag — `v0.0.0` until there is
 * another — up to `HEAD`, which is exactly the range `AGENTS.md` §7 says the
 * reviewer reads. Continuous integration passes its own range as an argument.
 */

const DEFAULT_BASE = 'v0.0.0';

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

function range() {
  const given = process.argv[2] ?? process.env['GATE_COMMIT_RANGE'];
  if (given !== undefined && given !== '') {
    return given;
  }
  try {
    git(['rev-parse', '--verify', '--quiet', `${DEFAULT_BASE}^{commit}`]);
    return `${DEFAULT_BASE}..HEAD`;
  } catch {
    // No tag yet, which is only true before the first promotion's base tag
    // exists. Everything reachable from HEAD is then the range.
    return 'HEAD';
  }
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

const selected = range();
process.stdout.write(`commits: checking ${selected}\n`);
report('commits', [...conventionalFindings(selected), ...attributionFindings(selected)]);
