---
title: A roadmap badge for the README
paths:
  - src/badge.ts
  - src/run.ts
  - test/badge.test.ts
  - docs/setup.md
  - dist/**
criteria:
  - id: endpoint
    text: "badge.json is published beside the roadmap page in the shields.io endpoint format, with how many specs are done and how many proposals are open."
    tests: [test/badge.test.ts]
  - id: votes-wanted
    text: "When a proposal is waiting for votes the badge says so and changes colour, so a visitor to the README sees there is something to vote on."
    tests: [test/badge.test.ts]
---

The roadmap page is one click away from nowhere: a visitor to the repository does not know it exists. A badge at the top of the README links to it and shows, at a glance, whether there is a spec waiting for votes.

```markdown
[![roadmap](https://img.shields.io/endpoint?url=https://OWNER.github.io/REPO/badge.json)](https://OWNER.github.io/REPO/)
```

Not in this spec: a badge per spec, and an SVG drawn by spectree itself.
