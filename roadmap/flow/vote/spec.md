---
title: Votes are reviews
paths:
  - src/tally.ts
  - src/evaluate.ts
  - test/**
criteria:
  - id: latest-wins
    text: "Each person has one vote: their latest Approve or Request changes."
    tests: [test/core.test.ts]
  - id: stale
    text: "A vote made on an earlier version of the spec does not count."
    tests: [test/core.test.ts]
  - id: weights
    text: "A person with write access has weight 1, everyone else 0, and ratings override both."
    tests: [test/core.test.ts]
  - id: record
    text: "The approval is recorded against a digest of the spec files, in the workflow's own comment."
    tests: [test/run.test.ts]
---

GitHub stores the votes as pull-request reviews. The workflow only counts them.

The author counts as one vote for, because GitHub does not let an author review their own pull request.
