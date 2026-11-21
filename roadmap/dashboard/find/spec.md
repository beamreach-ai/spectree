---
title: "Search, filters and links into the roadmap"
planned: now
---

The tree is fully open and cannot be searched or narrowed. On a large roadmap, finding one spec means scrolling, and a view cannot be sent to someone else.

- A search box that matches titles, ids and summaries as the visitor types.
- Filters for status, horizon and top-level node. Filters combine.
- Groups start closed when the roadmap has more specs than a threshold; a search or a filter opens the groups that hold matches.
- The search and the filters live in the URL, so a filtered view is a link.
- Every spec has an anchor that is its id; opening a link to it opens its groups and scrolls to it.

Acceptance, to become criteria when this is built:

- The page works with no network requests beyond itself: search and filters run on the data in the page.
- With scripts off, the full tree is shown and readable.
- A link with filters and an anchor restores the same view.
- The count of matches is shown, and "no specs match" when there are none.
- The threshold for closed groups is a setting, 40 by default.

Not in this spec: saved views, and search across repositories.
