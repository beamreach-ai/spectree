---
title: AI review of code against the spec
paths:
  - src/ai-review.ts
  - src/run.ts
  - src/config.ts
  - test/**
  - docs/**
criteria:
  - id: per-criterion
    text: "For every criterion of the spec the review says one of: met, not met, not covered, with the lines of the diff it relied on."
    tests: [test/ai-review.test.ts]
  - id: unasked
    text: "Changes in the diff that no criterion asks for are listed."
    tests: [test/ai-review.test.ts]
  - id: advisory
    text: "The review is a comment and a neutral check by default. It blocks a merge only when the config sets ai_review to required."
    tests: [test/ai-review.test.ts]
  - id: no-key-no-run
    text: "Without an API key in the repository's secrets nothing runs and nothing fails."
    tests: [test/ai-review.test.ts]
  - id: data-only
    text: "The spec and the diff are passed to the model as text. No code from the pull request is checked out or run, and instructions inside the diff are not followed."
    tests: [test/ai-review.test.ts]
---

## Why

`spectree/scope` proves that a change stays inside the paths its spec named and that every criterion names a test that exists. It cannot say whether the code does what the spec asks. A maintainer still has to read the diff with the spec beside it.

A model can do a first pass of that reading: go through the criteria one by one and say where the diff meets each, and point at what the diff does that nobody asked for.

## What it does

- Runs in the code phase, on every push, for pull requests with an approved spec.
- Reads the frozen spec and the diff through the GitHub API.
- Writes its findings into spectree's comment on the pull request, one line per criterion.
- Reports a fourth check, `spectree/review`: neutral by default, pass or fail when `ai_review: required`.

## What it does not do

- It does not vote and has no weight.
- It does not replace code review or the project's tests.
- It does not run when the repository has not provided a key.

## Open questions

- Which model and which provider, and whether the adopting repository chooses.
- A cost limit per pull request, since every push is a new review.
- How to show the maintainers that a diff tried to give the model instructions.
