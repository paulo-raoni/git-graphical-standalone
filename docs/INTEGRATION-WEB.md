# Web integration contract

**Status: draft, proposed 2026-11-15.** It needs two approvals before any work starts. The owner must approve the
epic that builds it, as `AGENTS.md` §2 requires for any work outside the MVP. The first consumer, the owner's own
website, must confirm the contract. Until both are given, nothing here is built. Tracked in issue #20. A hosted,
live-reading mode is a separate question, tracked in issue #21, and this contract assumes none.

The requirements below are the website's answers of 2026-11-15, written down here in this project's words. This
document has measured nothing yet. Each number in it is a **target set by the consumer**, and the slice that
delivers each part measures it.

## 1 · What is delivered

| artefact | what it is | versioned by |
| --- | --- | --- |
| **Snapshot** | One JSON file describing a window of a repository's history, with the lane layout already computed | `schemaVersion`, an integer |
| **Exporter** | A command-line tool that writes a snapshot from a local clone | the package's semver |
| **Component** | `git-graph.js` and `git-graph.css`, a read-only `<git-graph>` custom element that draws a snapshot | the package's semver |
| **Demo app** | A static web build of the full viewer on one snapshot, served at its own host | the package's semver |

The snapshot and the component are pinned independently. A component release states the `schemaVersion` values it
reads.

## 2 · Snapshot, schema version 1

The snapshot is UTF-8 JSON, minified by default. Its keys are short because every byte ships to every visitor.

```
{
  "schemaVersion": 1,
  "generator": "git-graphical-standalone <version>",
  "repository": {
    "name": "<display name>",
    "commitUrl": "https://github.com/<owner>/<repo>/commit/{hash}"   // optional; {hash} is replaced
  },
  "window": { "count": <commits in this file>, "truncated": <true if older commits exist> },
  "refs": [ { "n": "<name>", "k": "head|branch|remote|tag", "c": <commit index> } ],
  "commits": [
    {
      "h": "<full hash>",
      "p": [<parent commit index, or -1 when the parent is outside the window>],
      "a": "<author name>",
      "t": <author time, Unix seconds>,
      "s": "<subject>",
      "x": <lane column>,
      "k": <lane colour index>
    }
  ],
  "edges": [ [<from commit index>, <to commit index>, <colour index>, [<column at each row between them>]] ]
}
```

- Commits are listed newest first, in the order the desktop application draws them. An index is a position in
  `commits`.
- **The layout is computed by the exporter**, with the same lane layout engine the desktop application uses. The
  component reads it and does no layout of its own.
- **Never in a snapshot:** e-mail addresses, file contents, changed-file lists, or anything from the working tree
  or the stash. A snapshot carries only what the page shows.
- **Deterministic:** the same repository state and the same options produce the same bytes, so that regenerating a
  snapshot gives a clean diff.
- The exact encoding of `edges` is settled by the slice that writes the exporter, and is frozen when schema
  version 1 is released. Before then this section may change.
- A change that an older component cannot read raises `schemaVersion`.

**Size target (the consumer's):** at most about 300 KB uncompressed for the default window.

## 3 · Exporter

```
npx git-graphical-standalone export <path to clone> --out <file.json>
    [--max-commits <n>]      default 1000
    [--branches <a,b,...>]   default: every branch
    [--name <display name>] [--commit-url <template>] [--pretty]
```

- It reads a local clone through the git command line and touches no network.
- It runs from `npx` and adds nothing to the consumer's repository except the JSON it writes.

## 4 · Component

```html
<link rel="stylesheet" href="/vendor/git-graph/<x.y.z>/git-graph.css">
<script src="/vendor/git-graph/<x.y.z>/git-graph.js" defer></script>

<git-graph src="/assets/graphs/braziliandev-site.json"
           lang="pt-BR"
           on-commit="details"
           rows="12"></git-graph>
```

| attribute | values | default |
| --- | --- | --- |
| `src` | the URL of a snapshot, same origin | required |
| `lang` | `en`, `pt-BR` | `en` |
| `on-commit` | `details` (opens a panel inline), `link` (follows `repository.commitUrl`), `none` | `details` |
| `rows` | the number of rows shown before it scrolls | all |

- The labels can be replaced through a `strings` property, an object keyed by label, set from script.
- When a commit is chosen, the element fires a `git-graph:select` event with `{ hash }`.

**Hard requirements:**

- **No network.** The component fetches nothing but its `src`: no fonts, no CDN, no telemetry.
- It works under a strict CSP: no `eval`, no `new Function`, and no inline script or style injected at runtime that
  a hash or nonce policy would block.
- It reads its theme from `[data-theme]` on `<html>`, dark by default, and **does not** read
  `prefers-color-scheme`.
- Any animation runs only under `@media (prefers-reduced-motion: no-preference)`.
- Rows are DOM elements with text: subject, author, date and short hash. The graph is drawn on a canvas beside
  them, so screen readers and pages without canvas still read the history. Rows can be reached and chosen from the
  keyboard, and there is no focus trap. Content placed inside the element shows while the script has not run, so
  the page can put a plain list or a link there.
- Browsers: the last two versions of Chrome, Edge, Firefox and Safari.

**Size targets (the consumer's):** JS at most about 60 KB gzipped, CSS at most about 10 KB.

### Public theming surface

Only the names below are public, and they keep their meaning across minor versions. Each `--gg-*` variable falls
back to the consumer's token, and that token falls back to a built-in value, so the component also works on a page
that defines none of them.

| variable | falls back to |
| --- | --- |
| `--gg-bg`, `--gg-bg-raised` | `--bg-1`, `--bg-2` |
| `--gg-border`, `--gg-border-strong` | `--border`, `--border-strong` |
| `--gg-radius`, `--gg-shadow` | `--radius`, `--shadow-card` |
| `--gg-ink`, `--gg-ink-muted`, `--gg-ink-faint` | `--ink-0`, `--ink-1`, `--ink-2` |
| `--gg-focus` | `--focus` |
| `--gg-font-mono` | `--font-mono` |
| `--gg-lane-1` … `--gg-lane-8` | the component's built-in palette, which has its own light and dark sets |

The built-in lane palette has its own light and dark sets. In the dark set, lanes 1 to 3 may follow the consumer's
`--accent`, `--teal` and `--amber`. Those tokens are tuned for a dark background, so the light set does not take
them for granted: the slice that builds the palette checks that every lane stays distinct from the others and from
the light surfaces, and drops any brand token that fails. Lanes are thin structural marks, so this is a check of
how clearly they separate, not a text-contrast ratio. Under a CSP, the fetch of `src` needs `connect-src 'self'`.

The element's parts (`::part(row)`, `::part(details)`, `::part(ref)`) are public too. Any other class name or
internal structure is not.

## 5 · Demo app

A static build of the viewer, the same renderer as the desktop application, reading one or more snapshots in place
of git. It is published on GitHub Pages from this repository, as the project's own live demo. The website can
serve the same files at its own subdomain, as an independent static site that the website links to. Deploying to
the website's server is the owner's step, not this project's.

## 6 · What stays out

- No live reading of a repository from a server, and no provider tokens (issue #21).
- No write action of any kind.
- No private repository ships a snapshot; which repositories are shown publicly is the owner's choice.
