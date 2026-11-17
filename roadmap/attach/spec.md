---
title: Attaching it to a repository
paths:
  - src/cli.ts
  - src/bin.ts
  - src/index.ts
  - src/github.ts
  - action.yml
  - .github/workflows/**
  - test/**
criteria:
  - id: two-files
    text: "spectree init writes the two workflow files and never overwrites an existing one."
    tests: [test/run.test.ts]
  - id: config-from-main
    text: "The config is read from the default branch, never from a pull request."
    tests: [test/run.test.ts]
  - id: no-forged-record
    text: "An approval record in a comment not written by the workflow is ignored."
    tests: [test/run.test.ts]
---

No submodule and no copied code: one reusable workflow, called from two small files.

The workflow never checks out or runs a pull request's code.
