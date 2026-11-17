---
title: Planned leaves and specs of existing code
paths:
  - src/tree.ts
  - src/evaluate.ts
  - src/dashboard.ts
  - test/core.test.ts
  - test/run.test.ts
  - dist/**
criteria:
  - id: planned-leaf
    text: "A leaf with `planned` in its header needs no paths, no criteria and no code, and shows as planned on the roadmap page."
    tests: [test/core.test.ts]
  - id: planned-scope
    text: "Code in a pull request is never in scope of a planned leaf."
    tests: [test/core.test.ts]
  - id: existing-code
    text: "A leaf whose named tests are all in the default branch can merge without code."
    tests: [test/core.test.ts]
---

A project that adopts spectree already has a backlog and already has code.

- **The backlog.** A leaf with `planned: true`, or `planned: now`, `planned: next`, `planned: later`, is an entry the project agreed to and has not built. It merges without code. To build it, a pull request removes `planned`, adds the paths and the criteria, passes the vote and brings the code.
- **The existing code.** A leaf that describes code already in the default branch names tests that exist there. Such a leaf merges without code.
