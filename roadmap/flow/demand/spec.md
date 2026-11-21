---
title: "Demand: anyone can say they want a spec"
planned: next
---

The vote answers one question: does the project agree to this spec. It is a gate, decided by maintainers, and it cannot rank anything. A project with 300 agreed specs has no way to learn which of them its users want most, and a visitor has no way to say so.

Demand is a second signal, separate from the vote. It never decides whether a spec passes.

- Every spec has one **thread**: a GitHub issue with the label `spectree` whose title is the spec's id. The thread is created by the first person who uses it, from a link on the roadmap page that opens GitHub's new-issue form already filled in. The workflow creates nothing in advance, so a roadmap of 300 specs does not become 300 empty issues.
- A 👍 on the thread's first post is one person's demand for the spec. Anyone with a GitHub account can give it and take it back.
- For a spec that exists only in an open pull request, 👍 on the pull request's description counts the same way, shared by the specs it adds.
- The roadmap page shows each spec's demand, and a "most wanted" list of the top specs that are not done.
- The thread is also where a spec that is already in the default branch is discussed (see `dashboard/actions`).

Acceptance, to become criteria when this is built:

- Demand is the number of distinct people with a 👍; the same person on a thread and on a pull request counts once per spec.
- A 👎 is shown and does not subtract.
- Demand never changes a vote, a check or a status.
- A thread whose title matches no spec is ignored and listed in the run's log.
- The "most wanted" list length is a setting, 3 by default; with no demand anywhere it is not shown.
- `roadmap.json` carries each spec's demand and its thread.

Settings: `demand.enabled` (default true), `demand.top` (default 3).

Open question for the vote on the build: weighting demand by `ratings`, so that a customer's 👍 can count for more.

Not in this spec: demand from outside GitHub, and paid or sponsored priorities.
