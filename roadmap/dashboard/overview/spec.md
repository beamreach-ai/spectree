---
title: "The whole roadmap on one screen"
paths:
  - src/dashboard.ts
  - test/overview.test.ts
  - dist/**
criteria:
  - id: rows
    text: "The overview table has one row per top-level node, in the order of the tree, and a last row `All`; a top-level leaf is a row of its own. A roadmap with no specs has no overview."
    tests: [test/overview.test.ts]
  - id: status-counts
    text: "A row gives the number of leaves under its node that are done, in progress, approved and proposed, and the total of its leaves in every status. Each number equals the count the tree shows for that node, and the `All` row is the sum of the rows."
    tests: [test/overview.test.ts]
  - id: horizon-columns
    text: "There is one column per horizon that at least one planned leaf uses: `now`, `next`, `later` in that order, then the other horizons alphabetically, then `no horizon` for leaves with `planned: true`. A roadmap with no planned leaves has no horizon columns."
    tests: [test/overview.test.ts]
  - id: horizon-counts
    text: "A horizon cell is the number of leaves under the row's node whose status is planned and whose horizon is the column's. The horizon cells of a row add up to the planned count the tree shows for that node."
    tests: [test/overview.test.ts]
  - id: progress
    text: "Each row has a bar filled to done divided by total, rounded to a whole percent, with the text `<done> of <total> done`."
    tests: [test/overview.test.ts]
  - id: zero
    text: "A cell whose number is zero is empty."
    tests: [test/overview.test.ts]
  - id: jump
    text: "The title in a row links to that node's row in the tree below, and every node in the tree has an anchor to link to."
    tests: [test/overview.test.ts]
  - id: replaces-pills
    text: "The overview takes the place of the five total pills under the introduction; the page does not show both."
    tests: [test/overview.test.ts]
  - id: json
    text: "roadmap.json has an `overview` object with the ordered horizons, the rows and the `All` row, and the page's table is rendered from it."
    tests: [test/overview.test.ts]
---

The roadmap page says where the project stands in two places. Under the introduction there are five pills with totals for the whole roadmap: done, in progress, approved, proposed, planned. Below is the tree, every group open, one row per spec. The pills do not say which part of the project the numbers belong to, and they show "planned" as one number, whatever its specs say about now, next or later. The tree says it, but only to someone who reads every row. The question a visitor comes with — what is being built in which area, and what comes next — has no answer on the first screen.

This spec adds a table that answers it, and removes the pills.

## What the page shows

A section `Overview`, between the introduction and `Open proposals`. One table:

| Area | Progress | In progress | Approved | Proposed | now | next | later |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Dashboard](#) | ▓▓▓░░░ 3 of 9 done | 1 | | 1 | 2 | 1 | 1 |
| [Flow](#) | ▓▓▓▓░░ 4 of 6 done | | | | | 2 | |
| [Forges](#) | ░░░░░░ 0 of 1 done | | | | | | 1 |
| **All** | ▓▓▓░░░ 7 of 16 done | 1 | | 1 | 2 | 3 | 2 |

The numbers in this example are made up.

- **Rows.** One per top-level node: a node directly under the roadmap root. The order is the tree's. The last row, `All`, is the sum. A top-level node that is a leaf is a row with a total of 1.
- **First column.** The node's title, linking to its row in the tree on the same page. The column's heading is the name of the first level from `levels` in the settings, and `Spec` when the settings name no levels.
- **Progress.** A bar and the text `3 of 9 done`. Total is every leaf under the node, in any status. Groups are never counted.
- **In progress, Approved, Proposed.** Leaves that an open pull request adds, by the phase of that pull request. These three columns are always present.
- **Horizon columns.** One per horizon in use, under a shared heading `Planned`. A leaf counts here when its status is planned: it is in the default branch with `planned`, or an open pull request adds it with `planned` and the vote has passed. Its horizon is the text of `planned`, compared exactly as written. A planned leaf whose vote is still open counts under Proposed, as it does in the tree.
- **Zero** is an empty cell, so the table reads as a map of where the work is.
- **Narrow screens.** The overview stays a table and scrolls sideways inside its box. It does not fold into blocks as the proposals table does.

## What changes in the code

- `buildData` in `src/dashboard.ts` computes the overview once and returns it in `DashData`:

  ```ts
  interface OverviewRow {
    id: string;                          // the node's id; "" for the All row
    title: string;
    total: number;                       // leaves in every status
    counts: Record<NodeStatus, number>;  // the same object the tree's group row shows
    horizons: Record<string, number>;    // planned leaves per horizon; "" is `planned: true`
  }
  interface Overview { horizons: string[]; rows: OverviewRow[]; all: OverviewRow }
  ```

  `horizons` lists the columns in display order. `roadmap.json` carries the object as it is.
- `renderHtml` renders the table from `data.overview` and nothing else. Its own walk over the tree for the pill totals goes away with the pills.
- `renderNode` gives each node's `<li>` the attribute `id="spec-<node id>"`, which the first column links to.
- The tests are in a new file, `test/overview.test.ts`. The existing tests of the page keep passing, apart from the one that expects the pills.

## Not in this spec

- Links from a number to the list of specs behind it. That needs a filtered list, which is `dashboard/find`.
- Charts over time, estimates and dates.
- Any change to the tree or to `Open proposals`, apart from the anchors.
