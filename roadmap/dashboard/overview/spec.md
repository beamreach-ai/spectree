---
title: "The whole roadmap on one screen"
paths:
  - src/dashboard.ts
  - test/dashboard.test.ts
  - dist/**
criteria:
  - id: same-numbers
    text: "The overview is built from the same data as the tree, and its numbers equal the tree's."
    tests: [test/dashboard.test.ts]
  - id: grid
    text: "The grid has one row per top-level node and one column per horizon, and each cell holds the number of planned specs and links to them."
    tests: [test/dashboard.test.ts]
  - id: horizon-order
    text: "Horizons are ordered now, next, later, then the others alphabetically; a roadmap with no planned leaves shows no horizon columns."
    tests: [test/dashboard.test.ts]
  - id: progress
    text: "Each top-level node shows done against total, and its counts of in progress, approved and proposed."
    tests: [test/dashboard.test.ts]
  - id: size
    text: "The overview has one row per top-level node whatever the number of specs, so it does not grow with the roadmap."
    tests: [test/dashboard.test.ts]
  - id: json
    text: "roadmap.json carries the overview's numbers."
    tests: [test/dashboard.test.ts]
---

A roadmap of 324 specs is 17 screens of identical rows, and the summary above it reads "284 planned". Nobody can see what the project is building or where it stands.

The page opens with an overview that fits one screen at any roadmap size:

- A grid of the top-level nodes against the horizons (`now`, `next`, `later`, and any other the specs use), with the number of specs in each cell. A cell links to the list filtered to it.
- Per top-level node: a bar of done against total, and counts of in progress, approved and proposed.
- One line for the whole roadmap: specs done, being built, agreed, proposed.

Not in this spec: charts over time, and estimates or dates.
