---
title: Code stays inside the spec
paths:
  - src/evaluate.ts
  - test/**
criteria:
  - id: paths
    text: "A changed file outside the leaf's paths fails the scope check and is named."
    tests: [test/core.test.ts]
  - id: tests-exist
    text: "A test file named by a criterion must exist in the pull request or the default branch."
    tests: [test/core.test.ts]
---

This is the fixed-rule answer to whether the code does what the spec says. Whether the tests pass is the repository's own CI.
