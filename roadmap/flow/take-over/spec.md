---
title: Someone else writes the code
paths:
  - src/evaluate.ts
  - src/run.ts
  - test/**
criteria:
  - id: implements
    text: "A pull request with the same spec files and Implements: #n inherits the approval of #n."
    tests: [test/core.test.ts]
  - id: changed
    text: "If the spec files differ from the approved ones, the approval is not inherited."
    tests: [test/core.test.ts]
---

The approval belongs to the spec digest, not to the pull request.
