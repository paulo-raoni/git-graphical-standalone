# E04-M01-S16 · Details read on git 2.25

**Parent:** E04 Commit details, comparison and diff > E04-M01 Commit Details View > E04-M01-S16 details read on
git 2.25

The details read of E04-M01-S06 passed options that git 2.25, the requirement `docs/SETUP.md` states, does not
document. It now passes only options git 2.25's documentation names, and reads the same bytes as before on the git
installed here. Three gaps the reviews carried around the same read are closed beside it: a carriage return that
ends a `-z` record is kept, a details reply for a repository no longer open is held by a case, and a selected
branch is read only when the page's own listing names it. None of this is behaviour of Git Graph: what each git
version accepts is read from git's own documentation.

## What git 2.25 accepts, and how it was read

**No git older than 2.51.0 is installed on this machine, and none was downloaded.** What git 2.25 accepts is
established from its documentation alone: the files under `Documentation/` of the git/git repository at the tag
`v2.25.0`, read raw from `raw.githubusercontent.com`, and the same files at earlier `vX.Y.0` tags for the first
version that names each option. A first version is the first `.0` release whose documentation names the option,
with the minor release before it read and found not to; an option still named at the oldest tag read, `v1.6.0`,
says so. Most first versions were read by a research agent of this slice, which read every minor tag from `v1.7.0`
to `v2.33.0` and `v1.6.0`; this slice read again, itself, `--no-optional-locks` (`v2.14.0` absent, `v2.15.0`
present), `--[no-]use-mailmap` (`v2.22.0` names `--use-mailmap` only, `v2.23.0` the negated form), the `-m`
sentence below (`v1.7.0` absent, `v1.7.1` present) and every row's presence at `v2.25.0`.

Three options S06 passed are not named at 2.25:

- `--diff-merges=first-parent`: first named by `v2.31.0` (`Documentation/diff-options.txt`), absent at `v2.30.0`;
- `--no-relative`: first named by `v2.28.0` (`Documentation/diff-options.txt`), absent at `v2.27.0`;
- `--root`: not named by `v2.25.0`'s `git log` page, whose files are `git-log.txt` and the six it includes
  (`line-range-format.txt`, `rev-list-options.txt`, `pretty-formats.txt`, `diff-options.txt`,
  `diff-generate-patch.txt`, `i18n.txt`), nor by git-scm.com's rendering of that page. Git documents it for
  `git diff-tree`.

With the first two given to every commit, every commit's details would have failed on git 2.25 to 2.30, not only a
merge's. That is an inference from the documentation: no such git was run.

## What the read passes now

| what | passed as | first named by | read in, at that tag |
| --- | --- | --- | --- |
| no pager | `--no-pager` | v1.6.0, earlier not searched | `Documentation/git.txt` |
| no optional locks | `--no-optional-locks` | v2.15.0 (v2.14.0 absent) | `Documentation/git.txt` |
| the repository | `-C <path>` | v1.8.5 (v1.8.4 absent) | `Documentation/git.txt` |
| a setting | `-c <name>=<value>` | v1.7.2 (v1.7.1 absent) | `Documentation/git.txt` |
| one commit | `-1` (`-<number>`) | v1.6.0 (`-<n>::`), earlier not searched | `git-log.txt`; `rev-list-options.txt` from v2.0.0 |
| the header | `--format=<format>` | v1.7.4 (v1.7.3 has `--format='<format>'`) | `Documentation/pretty-options.txt` |
| its fields | `%H %P %an %ae %ad %cn %ce %cd`, `%x1e`, `%x1f` | `%x00` at v1.6.0, earlier not searched | `Documentation/pretty-formats.txt` |
| the message | `%B` | v1.7.2 (v1.7.1 absent) | `Documentation/pretty-formats.txt` |
| raw dates | `--date=raw` | v1.7.0 (v1.6.0 lists no `raw`) | `Documentation/rev-list-options.txt` |
| no mailmap | `--no-use-mailmap` | v1.8.2 by `gitcli`'s negation rule; by name v2.23.0 | `git-log.txt`, `gitcli.txt` |
| a merge against its first parent | `-m` with `--first-parent` | `-m` with the first-parent sentence v1.7.1; `--first-parent` v1.6.0 | `Documentation/rev-list-options.txt` |
| changed files | `--raw`, `--numstat`, `-z` | v1.6.0, earlier not searched | `Documentation/diff-options.txt` |
| renames | `-M` | v1.6.0 as `-M::`; `-M[<n>]` v1.7.3 | `Documentation/diff-options.txt` |
| the end of the options | `--` | named at v2.25.0 in the `git log`, `git diff` and `git status` synopses; earlier not searched | each command's page |
| the uncommitted status | `--porcelain=v2` | v2.11.0 (v2.10.0 has `--porcelain` alone) | `Documentation/git-status.txt` |
| | `--branch`, `--untracked-files=all` | v1.7.2; v1.7.0 | `Documentation/git-status.txt` |

`gitcli`'s rule, read at `v1.8.2` and again at `v2.25.0`: options with long names can be negated by prefixing
`--no-`. `-m`'s sentence at `v2.25.0`, in `rev-list-options.txt`: only the diff against the first parent is shown
when `--first-parent` is given, and the output is then what the merge brought into the then-current branch.

**Three settings, given with `-c`.** `git.txt` at `v2.25.0` documents that a value given with `-c` overrides the
configuration files. Each setting is one a newer git reads and git 2.25 does not:

| setting | replaces | the setting first named by | why it is given |
| --- | --- | --- | --- |
| `diff.relative=false` | `--no-relative`, in both reads of changed files | v2.28.0 (v2.27.0 absent), `Documentation/config/diff.txt` | from 2.28.0 a user's `diff.relative=true` lists only the files under the folder a repository was opened from |
| `log.showRoot=true` | `--root` | v1.6.0 as `log.showroot`, camel-cased from v2.4.0; `Documentation/config.txt`, `config/log.txt` from v2.20.0 | a user's `log.showRoot=false` hides a root commit's files |
| `log.diffMerges=first-parent` | (new) | v2.32.0 (v2.31.0 absent), `Documentation/config/log.txt` | from 2.32.0 the setting chooses what `-m` shows |

A git older than the version that first names a setting has no such setting to guard against, and reads a key it
does not know as nothing: git 2.51.0 ran `log` with `-c no.such.key=1` as without it. That older gits do the same is
an inference: no older git was run.

**The floor these options need is 2.15.0**, raised by `--no-optional-locks`, which every command passes; none of
the options above raises it. E01-M01-S03's derivation named 2.14.0, and `Documentation/git.txt` at `v2.14.0` does
not name the option, so `docs/SETUP.md` now says 2.15.0. Only the details read's options were read again here; the
rest of S03's derivation was not.

## Measured on git 2.51.0

Each measurement below was taken by this slice on a scratch repository, unless it names a test.

- **The same bytes.** `-m --first-parent` and `--first-parent -m` each printed a merge's whole output, 292 bytes, byte for
  byte as `--diff-merges=first-parent` did, under the overrides every list carries. Over every commit of every fixture of
  the adapter suite (the ten repositories published in its fixture store, merges and roots among them), the read as it was at
  Base and the read as it is now printed the same bytes for every commit: 15 041 commits, every one
  `rev-list --all` lists, of which 5 are merges (stash entries among them) and 11 are roots, none differing.
- **`log.diffMerges`.** Set to `combined`, git printed a merge with no changed file at all under
  `-m --first-parent --raw`, and its files against the first parent with `-c log.diffMerges=first-parent`;
  `dense-combined` and `remerge` changed the output too, and `separate`, `on` and
  `log.diffMerges-m-imply-p=true` did not. Given after the user's value, the override won every time.
- **`log.showRoot`.** With `log.showRoot=false` set through `GIT_CONFIG_COUNT`, a root commit printed no changed
  file, and every file as added with `-c log.showRoot=true`.
- **The options this machine's git cannot refuse.** With `--diff-merges=first-parent` put back in place of
  `-m --first-parent`, every case of `git-details.spec.ts` stayed green, merges included: this git reads both forms
  the same. The case that read it red is the floor case of `git-floor.spec.ts` below.

What git 2.31 to 2.50 print for `-m --first-parent --raw` was not run. Their `-m` documentation says it produces
output only with `-p`; git 2.51.0's says the same and printed `--raw` output for it, so that sentence is read as
naming patch output by example, which is an inference.

## A carriage return that ends a record

`src/core/parse/records.ts` dropped a carriage return that ended any record. Fed records ending in one, it read the
NUL-terminated `one\r` as `one`, `two\r\r` as `two\r` and `\r` as an empty record.

Which of those returns belong to the data was measured with git: `%s` never ends in one, because git trimmed it
from every subject tried (`only\r`, `tab\t\r\n`, `x\r\r\n`, a bare `\r\n`, and a first paragraph of two lines each
ending in `\r\n`), whether the commit was made by `commit-tree` or by `commit --cleanup=verbatim`, and with the
return still in the commit object. But `status --porcelain=v2 -z` wrote the record of an index path `cr-name\r`
(added with `core.protectNTFS=false`, which Git for Windows needs for such a name) with the return before the NUL.
The stash list's last field is `%P` and holds no return. So under `-z` git writes no return as a separator, and the
only one that can end a record is data.

The splitter now drops one return from a line-terminated record only, which is `for-each-ref`'s format, whose
fields may hold no control character. `records.test.ts` holds both: NUL-terminated records keep every return at
every chunk size, and a line-terminated record and its unended last drop one return each and no more. A third case
reads empty line-terminated records at every chunk size: with the return check moved behind the terminator's, no
NUL-terminated record reached the `to > from` bound any more, and the mutation gate found its two mutants alive
until that case.

## A details reply for a repository no longer open

`details` in `src/app/repository-host.ts` drops a reply when another repository was opened while the read ran. An
end-to-end case holds it, in `test/e2e/details-dropped-and-listed-branches.spec.ts`, with its timing made certain
rather than raced: the repository opened first includes, by `include.path`, a named pipe the test process serves,
and git opens that path at the start of every command it runs there. While the case holds the pipe, a git that
opened it waits on it. So the case asks for the details, waits until a git is waiting on the pipe, opens the second
repository over the bridge and sees its page, and only then lets the pipe go: the details reply is decided after
the open was applied, in every run. On a scratch repository git 2.51.0 opened the pipe four times a command, read
through in 161 ms with the pipe answering at once, and waited 1 650 ms on a pipe held for 1 500 ms.

The test process must run no synchronous git in that repository once the include is set, because a git of its own
there would wait on a pipe its own blocked event loop serves. The case's first run did, and hung until stopped.

## A selected branch read only when the page lists it

The utility process now answers only a page whose own reference listing names every name its log was given as a
branch or a remote branch (`readListed`). The listing is read in the same request as the log, after it, so the page
is read and, when the listing does not name every selected name, read again under the names it does name. Every
read after the first drops at least one name, so there is at most one more read than there are names; a repository
whose selected branches all exist pays for one read, as before. The selection kept is the one asked for, so a
branch made again under a deleted name is read again from the next page on.

The listing is read from the reference columns themselves rather than through `branchEntries` of
`src/contracts/branch-menu.ts`: with that, `npm run gates:size` measured `branch-menu.ts` and `ref-list.ts`
arriving in `repository.cjs`, 891 bytes the module manifest refuses.

The end-to-end case builds, in a repository of its own, a branch `gone` with a commit of its own and a tag
`refs/tags/refs/heads/gone` on a commit only it reaches; selects `refs/heads/main` and `refs/heads/gone`; deletes
`gone`; and refreshes. Git given the same names reads the tag's commit; the page, refreshed and selected again, holds
`main`'s history alone.

## Tests

- `src/adapters/git-floor.spec.ts`: every option the details read passes has a first version at or below 2.25 in
  the table above, and a merge and a root commit read the same files under `log.diffMerges` and `log.showRoot`.
- `src/core/parse/records.test.ts`: the two return cases above.
- `test/e2e/details-dropped-and-listed-branches.spec.ts`: the dropped reply and the listed-only selection.
- The adapter's existing details cases, unchanged, read the same files, statuses and counts as at Base.

## Size

`repository.cjs` measured 34 567 production bytes by `npm run gates:size` on 2026-11-08, inside its 35 840 budget,
which this slice did not change; E04-M01-S13's record of the same bundle at its own head is 34 098.
