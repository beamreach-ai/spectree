---
title: "Search, filters and links into the roadmap"
paths:
  - src/dashboard.ts
  - src/find.ts
  - src/config.ts
  - test/find.test.ts
  - test/overview.test.ts
  - dist/**
criteria:
  - id: search
    text: "A leaf matches a search when every word of it is found, whatever the case, in the leaf's title, id or summary. An empty search matches every leaf."
    tests: [test/find.test.ts]
  - id: filters
    text: "A leaf matches the status filter when its status is the chosen one, the horizon filter when it is planned with the chosen horizon, and the node filter when it is the chosen top-level node or under it. Search and filters combine: a leaf is shown when it matches all that are set."
    tests: [test/find.test.ts]
  - id: groups
    text: "While a search or a filter is set, a group is shown and open when a leaf under it is shown, and hidden otherwise."
    tests: [test/find.test.ts]
  - id: count
    text: "While a search or a filter is set, the page says how many leaves are shown out of how many, and `No specs match.` when none are."
    tests: [test/find.test.ts]
  - id: url
    text: "The view is the query string: `q`, `status`, `horizon` and `top`. Reading a query string and writing it back gives the same view, an unset part is left out, and a value the page does not know is ignored."
    tests: [test/find.test.ts]
  - id: anchor
    text: "A node named by the address's anchor is shown and its groups are open, whatever the search and the filters say."
    tests: [test/find.test.ts]
  - id: closed
    text: "When the roadmap has more leaves than `dashboard.collapse_over`, 40 unless set, every group is rendered closed; otherwise every group is rendered open. `0` keeps groups always open."
    tests: [test/find.test.ts]
  - id: overview-links
    text: "Each number in the overview that is not zero, except the progress text, links to the view it counts: its row's top-level node with its column's status or horizon. The `All` row's links leave the node out."
    tests: [test/find.test.ts]
  - id: controls
    text: "The page has a search box, a status list, a top-level node list, and a horizon list when the roadmap uses horizons. They are rendered hidden and the page's own script shows them, so a visitor with scripts off sees the whole tree and no dead controls."
    tests: [test/find.test.ts]
  - id: self-contained
    text: "The script is in the page, loads nothing, and works on what the page already holds: each node carries its status, horizon, kind and searchable text as attributes."
    tests: [test/find.test.ts]
---

The tree under `Specs` shows every spec, with every group open. To find one spec a visitor scrolls or uses the browser's find, which matches a title and says nothing of its status or horizon. There is no way to see only what is planned for now, or only one area, and no way to send such a view to someone else. The overview added in `dashboard/overview` counts specs per area and horizon, and its numbers lead nowhere.

This spec adds a search box and three filters above the tree, puts the view in the address so it can be shared, and makes the overview's numbers links.

## What the page shows

A bar directly under the `Specs` heading, above the tree:

```
[ Search specs…          ]  [ Any status ▾ ]  [ Any horizon ▾ ]  [ Any area ▾ ]   12 of 31 specs · Clear
```

- **Search.** Narrows the tree as the visitor types. The words are split on spaces; each must be found in the title, the id or the summary of a leaf. Case is ignored. Groups are not searched: a group stays when a leaf under it stays.
- **Status.** `Any status`, then Done, In progress, Approved, Proposed, Planned.
- **Horizon.** `Any horizon`, then the horizons in the order of the overview's columns, with `no horizon` for `planned: true`. The list is left out when no planned leaf exists. Choosing a horizon shows planned leaves only.
- **Top-level node.** `Any <level>`, where the level is the first of `levels`, then the titles of the top-level nodes in the tree's order.
- **Count and Clear.** Shown only while something is set: `12 of 31 specs`, counting leaves, or `No specs match.` `Clear` empties the search and the three lists.
- **The tree while something is set.** Leaves that do not match are hidden. A group with a shown leaf is shown and open; other groups are hidden. When nothing is set the tree is as the page rendered it.
- **A leaf with specs under it** is treated as a leaf: it is matched itself, and it is also kept, like a group, when a leaf under it is shown.

## The address

The view is kept in the query string and changes as the visitor types and chooses, without adding entries to the browser's history.

| Part | Meaning | Example |
| --- | --- | --- |
| `q` | the search | `q=vote+weight` |
| `status` | `done`, `in_progress`, `approved`, `proposed` or `planned` | `status=planned` |
| `horizon` | a horizon as written in the specs; present and empty is `planned: true` | `horizon=now` |
| `top` | the id of a top-level node | `top=dashboard` |

A part that is not set is not in the address. A `status`, `horizon` or `top` the page does not know is dropped. Opening an address restores the view, the controls included.

An anchor works as before, `#spec-<id>`, and now also opens the groups above the node so that it can be scrolled to. If the search or the filters would hide that node, it is shown anyway.

## Closed groups

The page is rendered with every group open, as today, up to a number of leaves; above it every group is rendered closed and the visitor opens what they need, or searches. The number is a new setting:

```yaml
dashboard:
  collapse_over: 40   # the default; 0 never closes the groups
```

It must be a whole number, zero or more; anything else is an error in the settings.

## The overview's numbers

Each number in the overview becomes a link to the tree narrowed to what it counts, for example `?top=flow&horizon=next#specs` for the cell of `flow` under `next`, and `?status=proposed#specs` for Proposed in the `All` row. The `Specs` heading gets the anchor `specs`. Empty cells and the `3 of 9 done` text stay as they are.

## What changes in the code

- A new file `src/find.ts` holds the logic as functions that take and return plain data and touch no page:
  - `parseView(query, known)` and `writeView(view)`: between a query string and `{ q, status, horizon, top }`. `horizon` is `null` when unset and `""` for `planned: true`.
  - `matches(node, view)`: one leaf against a view. `node` is `{ id, kind, status, horizon, text }`.
  - `visible(nodes, view, anchor)`: the ids to show, the ids to open, and the number of leaves matched and in all.
- `renderHtml` puts these same functions into the page's script with `Function.prototype.toString`, so the page runs the code the tests run. The rest of the script only reads the controls and the address, calls `visible`, and sets `hidden` and `open` on the nodes.
- `renderNode` adds `data-kind`, `data-status`, `data-horizon` and `data-text` to each node's `<li>`; `data-text` is the title, the id and the summary in lower case. It renders groups closed when the leaves outnumber the setting.
- `renderHtml` renders the bar with the attribute `hidden`, and the overview's links.
- `src/config.ts` reads `dashboard.collapse_over`.
- The tests are in a new file, `test/find.test.ts`. They cover the four functions, the attributes and links in the page, and the setting. Two tests in `test/overview.test.ts` are loosened: they compared a node's whole opening tag and searched the whole page for the word Planned, and both now hold more. The few lines that connect the controls to the functions run only in a browser and are checked by hand with `spectree preview` before the pull request is ready.

## Not in this spec

- Grouping the tree by horizon; that is `dashboard/rows`.
- Searching the proposals table, criteria or whole spec bodies.
- Saved views, and search across repositories.
