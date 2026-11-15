/**
 * The characters no reference name may hold anywhere, besides the control
 * characters and space, which are refused by code below: `~` and `^` introduce
 * git's parent and peel operators, `:` separates the two halves of a refspec
 * and a path inside a tree, `?`, `*` and `[` are pathname patterns, and `\` is
 * refused outright.
 */
const REFUSED_CHARACTERS = '~^:?*[\\';

/** The highest character code that is refused for being a control character or space. */
const LAST_CONTROL_OR_SPACE = 0x20;

/** `DEL`, the one control character above space. */
const DELETE = 0x7f;

/**
 * Whether `name` is a reference name git accepts: the rules of
 * `git check-ref-format`, applied to the whole name, with neither
 * `--allow-onelevel` nor `--normalize` nor `--refspec-pattern`.
 *
 * A name is refused when, anywhere in it, it holds
 *
 * - `..`, which git reads as a range: `a..b` is the commits of `b` not in `a`,
 *   and `a...b` the commits of either not in both;
 * - `@{`, which git reads as a reflog entry or a previous checkout;
 * - a control character (U+0000 to U+001F, or U+007F), a space, or one of
 *   {@link REFUSED_CHARACTERS};
 *
 * and when, at its ends or between its slashes, it
 *
 * - has no `/` at all: a name of one level, which is how the single character
 *   `@`, git's own spelling of HEAD, is refused too;
 * - begins or ends with `/`, or holds `//`, which is a component of no length;
 * - has a component beginning with `.`, or ending with `.lock`;
 * - ends with `.`.
 *
 * Characters past U+007F are accepted, as git accepts them.
 *
 * Measured against git rather than taken from its documentation alone: this
 * function and `git check-ref-format` (git 2.51.0) gave the same verdict on every
 * name of a corpus built for the purpose by E04-M01-S02 on 2026-11-03 — each
 * name `refs/heads/<x>` where `<x>` is every string of one or two characters
 * over an alphabet holding every rule's character and a few accepted ones, and
 * a further list of whole names written by hand for the rules a short suffix
 * cannot reach. The corpus, its size and its result are in that slice's
 * document.
 *
 * Here and not in the adapter because it decides which names a page is read
 * from, a decision that can be wrong
 * (`docs/ADR-0002-architecture-and-performance.md` decision 1); it spawns no git,
 * so it costs a page request no process.
 */
export function isRefName(name: string): boolean {
  if (name.includes('..') || name.includes('@{') || name.endsWith('.')) {
    return false;
  }
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (
      code <= LAST_CONTROL_OR_SPACE ||
      code === DELETE ||
      REFUSED_CHARACTERS.includes(character)
    ) {
      return false;
    }
  }
  const components = name.split('/');
  return (
    components.length > 1 &&
    components.every(
      (component) =>
        component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'),
    )
  );
}
