---
title: "Open proposals as a queue of what waits for whom"
planned: now
---

The proposals table lists pull requests by number. A maintainer wants to know what waits for them; a contributor wants to know what they can pick up. The table makes both read every row. A pull request that adds 28 specs prints 28 ids in one cell, and with one maintainer every tally reads "1 of 1 for".

The table becomes a queue in groups, in this order: needs votes, needs a fix to the spec, approved and waiting for code, in code review, ready to merge.

- Each proposal shows its age and how long it has been in its current step.
- A proposal with more than three specs shows a count and the group they share ("28 specs in integrations"), and opens to the list.
- The tally is shown in full when a vote is open or anyone other than the author voted. Otherwise it is one word: approved.
- "Approved and waiting for code" is the list of work anyone can take, and says how (see `flow/take-over`).
- Empty groups are not shown.

Acceptance, to become criteria when this is built:

- Every open spec pull request is in exactly one group.
- Within a group, the oldest in its step is first.
- A proposal waiting longer than a setting is marked as stale: `stale_days`, 30 by default.
- `roadmap.json` carries the step, the age, and the time in the step.

Not in this spec: a per-person view ("waiting for me"), which needs a signed-in visitor.
