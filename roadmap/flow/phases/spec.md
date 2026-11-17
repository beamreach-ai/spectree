---
title: Spec phase and code phase
paths:
  - src/evaluate.ts
  - src/run.ts
  - test/**
criteria:
  - id: early-code
    text: "Code in a spec pull request before approval fails the phase check."
    tests: [test/core.test.ts]
  - id: frozen
    text: "A spec edited after approval sends the pull request back to the vote."
    tests: [test/run.test.ts]
  - id: group
    text: "A group merges after approval with no code. A leaf does not."
    tests: [test/core.test.ts]
  - id: maintainers-mode
    text: "With implementation set to maintainers, code from a person without write access fails."
    tests: [test/core.test.ts]
---

The spec is frozen at approval. Reviews after that are code review and no longer votes.
