---
title: "Rows a person can scan"
planned: now
---

Every row carries a level name, a title, the id that repeats the title, a grey pill and a count of criteria. On a planned roadmap all rows look the same, long titles wrap over three lines, and now, next and later cannot be told apart at a glance.

- The id and the level name leave the row; the id is in the spec's view and in its anchor.
- The horizon is a marker with its own colour for now, next and later, and the tree can be grouped by horizon instead of by directory.
- A status is shown as a pill only when it is not the most common one in its group.
- A title longer than one line is cut with the full text on hover and in the spec's view.
- A group's row shows a bar of its leaves by status, in place of a row of pills.

Acceptance, to become criteria when this is built:

- A leaf's row is one line at 1280 px wide, whatever the title's length.
- Colours meet WCAG AA contrast in the light and the dark theme, and no information is carried by colour alone.
- Grouping by horizon and by directory show the same specs.

Not in this spec: custom colours and themes per repository.
