---
title: "The whole roadmap on one screen"
planned: now
---

A roadmap of 324 specs is 17 screens of identical rows, and the summary above it reads "284 planned". Nobody can see what the project is building or where it stands.

The page opens with an overview that fits one screen at any roadmap size:

- A grid of the top-level nodes against the horizons (`now`, `next`, `later`, and any other the specs use), with the number of specs in each cell. A cell links to the list filtered to it.
- Per top-level node: a bar of done against total, and counts of in progress, approved and proposed.
- One line for the whole roadmap: specs done, being built, agreed, proposed.

Acceptance, to become criteria when this is built:

- The overview is built from the same data as the tree, and its numbers equal the tree's.
- With 300 specs or 10, the overview is at most one screen at 1280×900.
- Horizons are ordered now, next, later, then the others alphabetically; a roadmap with no planned leaves shows no horizon columns.
- `roadmap.json` carries the overview's numbers.

Not in this spec: charts over time, and estimates or dates.
