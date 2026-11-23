---
title: "Rows a person can scan"
paths:
  - src/dashboard.ts
  - test/layout.test.ts
  - dist/**
criteria:
  - id: one-line
    text: "A node's row holds its title, with the full title as a tooltip, and no level name and no id. The level name and the id are the first line of what the row opens to."
    tests: [test/layout.test.ts]
  - id: horizon
    text: "A planned leaf shows its horizon as a marker with a class of its own for `now`, `next` and `later` and one shared class for any other; a leaf with `planned: true` shows `Planned`."
    tests: [test/layout.test.ts]
  - id: group-row
    text: "A group's row shows a bar and `<done> of <total> done`, a pill for each of in progress, approved and proposed that is not zero, and the number planned."
    tests: [test/layout.test.ts]
  - id: nested
    text: "A leaf with specs under it counts itself and the leaves under it, so the overview's total is the number of leaves in the tree."
    tests: [test/layout.test.ts]
---

Every row in the tree carries a level name, a title, the id that repeats the title, a pill and a count of criteria. Long titles wrap over several lines, a planned leaf reads `Planned: now` in the same grey as `Planned: later`, and a group prints up to five pills. On a roadmap of planned specs every row looks like every other.

## What the page shows

- **A leaf's row:** the title, one marker, links to the open pull requests that change it, and the number of criteria. The title stays on one line and is cut with an ellipsis; the full title is its tooltip. On a screen narrower than 640 px the title takes a line of its own and wraps.
- **The marker** is the status pill for done, in progress, approved and proposed. For a planned leaf it is the horizon: `now` in green, `next` in blue, `later` in grey, any other horizon in amber, each with a dot so that colour is not the only signal. `planned: true` reads `Planned`.
- **A group's row:** the title, a short bar, `3 of 9 done`, then pills only for in progress, approved and proposed when they are not zero, then `4 planned` in plain text.
- **Opening a row** shows, first, the level name and the full id, then the summary and the criteria as before. Every row can be opened.

## A leaf with specs under it

The tree allows a leaf to have specs below it; this repository has two. The page counted such a leaf as one spec and left out what is under it, so the overview's total was smaller than the number of specs the search counts. A leaf now counts itself and the leaves under it, in every count on the page.

## What changes in the code

- `renderNode` and `renderDetail` in `src/dashboard.ts`, and the styles of `.row`.
- `buildData`'s roll-up of counts.
- Tests in a new file, `test/layout.test.ts`.

## Not in this spec

- Grouping the tree by horizon: the horizon filter of `dashboard/find` does it.
- Hiding a status that is the most common in its group.
- Custom colours per repository.
