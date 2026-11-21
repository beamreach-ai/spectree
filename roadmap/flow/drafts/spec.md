---
title: The vote opens when the pull request is ready for review
paths:
  - src/run.ts
  - src/evaluate.ts
  - src/dashboard.ts
  - test/**
  - dist/**
criteria:
  - id: draft-waits
    text: "A draft spec pull request is not voted on: the spec check is pending with a description that says the vote opens when it is ready for review, and no approval is recorded, whatever the reviews say."
    tests: [test/core.test.ts]
  - id: draft-on-page
    text: "The roadmap page lists a draft as a draft, apart from the proposals that are open for votes, and its specs show as proposed."
    tests: [test/run.test.ts]
  - id: ready
    text: "Marking the pull request ready for review opens the vote, and reviews already given on the current spec count."
    tests: [test/run.test.ts]
---

Today a maintainer's spec passes the moment its pull request opens: the author counts as one vote for, and a maintainer weighs 1, which meets the default threshold. There is no time to write a spec in the open, or for anyone else to read it, before it is approved.

A draft pull request is GitHub's way of saying "not yet". spectree should treat it so: a draft gathers comments and reviews, and the vote starts when the author marks it ready. The workflow already runs on `ready_for_review`.

Not in this spec: a minimum time a vote stays open, and changing who counts as a maintainer.
