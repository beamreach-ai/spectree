---
title: "Read a whole spec on the roadmap page"
paths:
  - src/dashboard.ts
  - src/markdown.ts
  - src/find.ts
  - test/act.test.ts
  - dist/**
criteria:
  - id: markdown
    text: "A spec's row opens to its whole body rendered from Markdown: headings, paragraphs, bulleted and numbered lists with nesting, tables, quotes, code blocks, and inline code, bold, italics and links."
    tests: [test/act.test.ts]
  - id: no-html
    text: "No HTML written in a spec reaches the page as HTML, and a link goes only to an http, https or mailto address or to a path in the repository; any other link is left as its text."
    tests: [test/act.test.ts]
  - id: relative-links
    text: "A link to a path in the repository opens that file on the repository's host, on the default branch."
    tests: [test/act.test.ts]
  - id: stands
    text: "Under the body the page says where the spec stands: its status or horizon, the pull request that proposes it with the vote so far, and any pull request that proposes to change or remove it, in which case it says the text shown is the default branch's."
    tests: [test/act.test.ts]
  - id: short
    text: "A spec whose body is its first paragraph and nothing more has no separate whole view."
    tests: [test/act.test.ts]
  - id: with-children
    text: "A spec that has specs below it opens to those specs. Its own text is behind one closed line, `About this spec`, and a link to the spec opens that line too."
    tests: [test/act.test.ts]
  - id: json
    text: "roadmap.json carries each spec's body as Markdown."
    tests: [test/act.test.ts]
---

A spec's row opens to its first paragraph and its criteria. The rest of the spec, usually what it leaves out and why, is on GitHub as a raw file with a YAML header. Someone deciding how to vote needs the whole text and where the spec stands, and gets it by opening two more pages.

## What the page shows

Inside what a row opens to, after the summary and the criteria:

- **The whole spec**, closed until asked for: the body rendered from Markdown. A spec that is only one paragraph has no such line, since the summary is all of it.
- **Where it stands**, one line: the status, or `Planned: <horizon>`; for a spec in an open pull request, `proposed in #7, not in the default branch yet` and `vote: 0 of 1 for, 0 against`; for a spec that a pull request changes or removes, `#9 proposes to change it: …; the text here is the default branch's`.
- **A link of its own.** `#spec-<id>` is the spec's address, as before. Opening it now also opens the spec's own row, not only the groups above it.

## The renderer

A small renderer in a new file, `src/markdown.ts`, with no dependency. The text is escaped before anything else, so tags in a spec show as text. It knows:

| Markdown | Becomes |
| --- | --- |
| `#` to `######` | headings below the page's own: `h4` to `h6` |
| blank-line separated text | paragraphs |
| `-`, `*`, `+`, `1.` with indentation | nested lists |
| lines of `\|` cells under a `---` line | a table |
| `>` | a quote |
| fenced code | a code block, untouched |
| backticks, `**`, `*`, `[text](address)` | inline code, bold, italics, links |

A link's address is kept when it starts with `http://`, `https://` or `mailto:`. A relative path becomes `<repository>/blob/<default branch>/<path>`, taken from the repository's root. Anything else, `javascript:` included, and an anchor alone, leaves the link's text and no link.

## What changes in the code

- `src/markdown.ts`: `renderMarkdown`, `inlineMarkdown`, `linkTarget`.
- `buildData` keeps each node's `body`; the node's detail renders it.
- The page's script in `src/find.ts` opens the row an anchor points at.
- Tests in a new file, `test/act.test.ts`.

## Not in this spec

- Images, footnotes, task lists and HTML in specs.
- A spec's history: when it was proposed, approved and merged. `dashboard/recent` has the dates the page can know.
- A diff of a proposed change, and comments shown inside the page.


## A spec with specs below it

A leaf can have leaves under it: `dashboard` describes the page and holds the specs of its parts. The tree opens such a node to show its children, and used to show the node's own detail above them as well, so two specs stood expanded on the first screen while every other row was one line. Now the node opens to its children, and its own detail is behind a closed line, `About this spec`. A link to the spec (`#spec-<id>`) opens the line. A group is unchanged: it has no detail of its own beyond its first paragraph.
