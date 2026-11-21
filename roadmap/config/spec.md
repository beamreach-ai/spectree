---
title: Settings in .spectree.yml
paths:
  - src/config.ts
  - test/core.test.ts
  - dist/**
criteria:
  - id: defaults
    text: "With no .spectree.yml, or an empty one, every setting has its default."
    tests: [test/core.test.ts]
  - id: no-guessing
    text: "An unknown key or a value of the wrong type is reported with the name .spectree.yml, and the default is kept."
    tests: [test/core.test.ts]
---

Every key is optional. A typo must not silently change how a project votes, so nothing is guessed: a key spectree does not know is reported, and so is a value of the wrong type.

The file is read from the default branch only. That rule belongs to [attach](../attach/spec.md).

Today the messages call the file `.roadmap.yml`, its name before release. This spec fixes them.
