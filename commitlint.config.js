/**
 * `AGENTS.md` §9, as far as a tool can check it.
 *
 * The conventional preset carries the type, the scope shape, the imperative
 * subject and the blank line before the body. Two things are added:
 *
 * - **72 characters**, not the preset's 100, because §9 says 72.
 * - **the type list**, which is §5's list of lane types and nothing else, so
 *   that a branch and its commits cannot disagree about what kind of change
 *   this is.
 *
 * `subject-case` is left as the preset has it — never sentence, start, pascal or
 * upper case — rather than being tightened to all-lower-case. A subject may have
 * to name `ADR-0003` or `S02`, and a rule that forbids those forbids saying what
 * the commit is about.
 *
 * The rule §9 states that is **not** here is the one about AI attribution:
 * commitlint reads the header, and the trailer that rule forbids lives in the
 * body. `scripts/gates/commits.js` reads the whole message for it.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'type-enum': [
      2,
      'always',
      ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'test'],
    ],
  },
};
