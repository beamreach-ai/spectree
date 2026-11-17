---
title: Pull requests with no spec
paths:
  - src/evaluate.ts
  - src/run.ts
  - test/**
criteria:
  - id: fails
    text: "Code with no approved spec fails the spec check, with one comment that explains the flow."
    tests: [test/core.test.ts]
  - id: exceptions
    text: "Exempt paths, exempt authors and the no-spec label pass."
    tests: [test/core.test.ts]
  - id: close
    text: "With on_missing_spec set to close, the pull request is also closed."
    tests: [test/run.test.ts]
---

Small fixes do not need a vote: docs, workflow files, dependency bots, and anything a maintainer labels `no-spec`.
