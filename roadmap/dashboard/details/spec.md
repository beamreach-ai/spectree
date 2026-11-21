---
title: Read the roadmap without opening GitHub
paths:
  - src/dashboard.ts
  - src/evaluate.ts
  - test/dashboard.test.ts
  - dist/**
criteria:
  - id: criteria
    text: "Each leaf on the page opens to show what it is for and its criteria with the tests they name, for specs in the default branch and in open pull requests alike."
    tests: [test/dashboard.test.ts]
  - id: next-step
    text: "Each open proposal says what it waits for (votes, code, code review, a fix to the spec, or the merge) and who voted which way."
    tests: [test/dashboard.test.ts]
  - id: intro
    text: "The page opens with a paragraph on how the project takes changes, the vote a spec needs, and a link to how to propose and vote."
    tests: [test/dashboard.test.ts]
  - id: json
    text: "roadmap.json carries the same criteria, next steps and votes."
    tests: [test/dashboard.test.ts]
---

The page lists titles and statuses. To learn what a spec promises, or what a proposal needs to move on, a visitor opens GitHub and reads YAML. Someone who is deciding whether to vote, or to pick up an approved spec, should be able to do it from the page.

Not in this spec: rendering the whole body as Markdown, search, and filters.
