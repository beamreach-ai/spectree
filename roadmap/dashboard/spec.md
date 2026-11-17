---
title: The roadmap page
paths:
  - src/dashboard.ts
  - src/run.ts
  - test/**
criteria:
  - id: statuses
    text: "Each node shows done, in progress, approved or proposed, worked out from the default branch and open pull requests."
    tests: [test/run.test.ts]
  - id: proposals
    text: "Every open spec pull request is listed with its phase and live vote count."
    tests: [test/run.test.ts]
  - id: rollup
    text: "A group shows how many leaves below it have each status."
    tests: [test/run.test.ts]
---

A static page and a `roadmap.json`, published with GitHub Pages and rebuilt on every push, pull-request event and review.
