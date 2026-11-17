---
title: The spec tree
paths:
  - src/tree.ts
  - src/config.ts
  - test/**
criteria:
  - id: leaf-rules
    text: "A leaf without paths, criteria or tests is rejected with a sentence that says what is missing."
    tests: [test/core.test.ts]
  - id: no-status
    text: "A spec file stores no status. A status key in the header is an error."
    tests: [test/core.test.ts]
  - id: ancestors
    text: "A node whose parent directory has no spec.md is rejected."
    tests: [test/core.test.ts]
---

Every directory under `roadmap/` with a `spec.md` is a node. Nodes nest to any depth and level names come from depth.

Status is never written into a file. It is worked out from the default branch and the open pull requests, so it cannot go stale.
