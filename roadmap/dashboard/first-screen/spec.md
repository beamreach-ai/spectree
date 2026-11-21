---
title: "A first screen for a newcomer, a fresh repository and a phone"
planned: now
---

The page opens with a paragraph of rules. On a fresh repository that paragraph and an empty table are the whole page; on a large one it pushes everything down. On a phone the table and the tree both overflow.

- The rules become a strip of three steps (propose a spec, vote, add the code), each one line, with the vote a spec needs and a link to the full guide. A returning visitor can close it, and it stays closed.
- A repository with no specs shows an empty state: what a spec is, the **Propose a spec** action, and the two commands to check a tree locally.
- At 390 px wide: nothing scrolls sideways, the overview stacks, and every action is reachable with a thumb.

Acceptance, to become criteria when this is built:

- At 1280×900 the first screen shows the strip, the overview and the start of the queue.
- The page has no horizontal scroll at 390 px with the 324-spec roadmap.
- The empty state is shown only when the default branch has no specs and no proposal is open.
- The closed strip is remembered in the browser only; nothing is sent anywhere.

Not in this spec: translations of the page.
