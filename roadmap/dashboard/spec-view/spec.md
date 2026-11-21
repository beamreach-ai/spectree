---
title: "Read a whole spec on the roadmap page"
planned: next
---

The page shows the first paragraph of a spec. The rest, usually what it does not do and why, is on GitHub as a raw Markdown file with a YAML header. Someone deciding how to vote needs the whole spec, its vote and its history in one place.

A spec opens to its full view, on the page and by a link of its own:

- The body rendered from Markdown: headings, lists, tables, code, links.
- The criteria with the tests they name.
- Where it stands: status, horizon, the pull requests that add or change it, the tally and who voted, demand and the thread.
- Its history: when it was proposed, approved and merged, with links.
- The actions of `dashboard/actions`.

Acceptance, to become criteria when this is built:

- The body is rendered with no raw HTML passed through, and links open the repository's host for relative paths.
- A spec in an open pull request shows the proposed text, marked as not agreed yet.
- A spec changed by an open pull request shows the current text and a link to the proposed change.
- The view has a URL that survives a rebuild of the page.
- History comes from the default branch's commits for the spec's file; no status is stored anywhere.

Not in this spec: a diff view of a proposed change, and comments shown inside the page.
