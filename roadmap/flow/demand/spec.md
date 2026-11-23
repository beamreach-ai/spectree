---
title: "Demand: anyone can say they want a spec"
paths:
  - src/dashboard.ts
  - src/run.ts
  - src/github.ts
  - src/config.ts
  - test/demand.test.ts
  - dist/**
criteria:
  - id: thread
    text: "A spec's thread is the issue with the label `spectree` whose title is the spec's id; when several have it, the one opened first. An issue whose title is no spec's id is ignored and named in the run's log."
    tests: [test/demand.test.ts]
  - id: count
    text: "A spec in the default branch has as its demand the 👍 on its thread's first post. A spec that only an open pull request adds has the 👍 on that pull request's description. 👎 is counted beside it and never subtracted."
    tests: [test/demand.test.ts]
  - id: no-effect
    text: "Demand changes no vote, no check and no status."
    tests: [test/demand.test.ts]
  - id: page
    text: "A spec with demand shows it on its row, and a spec in the default branch links to its thread, or to the host's new-issue form filled in with the id and the label when it has none."
    tests: [test/demand.test.ts]
  - id: most-wanted
    text: "The page lists the specs not done with the most demand, most wanted first and at most `demand.top`, 3 unless set; with no demand anywhere the list is not shown."
    tests: [test/demand.test.ts]
  - id: settings
    text: "`demand.enabled: false` reads no issues, creates no label and shows no demand. `demand.top` is a whole number, zero or more."
    tests: [test/demand.test.ts]
  - id: lazy
    text: "The workflow creates the label when the repository lacks it and never creates an issue."
    tests: [test/demand.test.ts]
  - id: json
    text: "roadmap.json carries each spec's 👍, 👎 and thread, and the most wanted list."
    tests: [test/demand.test.ts]
---

The vote answers one question: does the project agree to this spec. It is decided by the people the project trusts, and it cannot rank anything. A project with a long list of agreed specs has no way to learn which of them its users want, and a visitor who wants one has no way to say so short of writing the code.

Demand is a second signal, beside the vote. It never decides whether a spec passes.

## How it works

- **The thread.** Every spec can have one issue: label `spectree`, title equal to the spec's id, for example `flow/demand`. Nobody creates threads ahead of time. The roadmap page links each spec to GitHub's new-issue form with the title, the label and a first post already filled in, and the first person who wants to say something submits it. A roadmap of three hundred specs does not become three hundred empty issues.
- **Wanting a spec** is a 👍 on the thread's first post. Anyone with an account can give it and take it back. GitHub lets one person react once, so the count is people.
- **A spec that is still a proposal** has no file in the default branch and takes the 👍 on the description of the pull request that adds it. Every spec that pull request adds shows the same number.
- **Never both.** A spec in the default branch counts its thread only, and a proposed one its pull request only, so nobody is counted twice.
- **👎** is shown next to the 👍 where a spec's standing is shown. It is not subtracted, and it is not a vote.

## What the page shows

- On a row: `👍 4`, when it is not zero.
- In what a row opens to: `4 👍, 1 👎` in the line on where the spec stands, and a link, `Discuss or 👍` to the thread, or `Start its thread` to the filled-in form.
- **Most wanted**, above the overview: the specs that are not done, ordered by 👍, ties by id, at most `demand.top`. A spec with no 👍 is never listed, and without any the section is absent.

## Settings

```yaml
demand:
  enabled: true   # false: no issues are read and the page shows no demand
  top: 3          # the length of Most wanted; 0 hides it
```

## What changes in the code

- `src/github.ts`: reading the labelled issues, reading one issue's reactions, creating the label when it is missing.
- `run` reads the threads once per sweep and each spec pull request's reactions, and passes both to the page. A failure to read them is a warning in the log, and the sweep goes on without demand.
- `buildData` sets `up`, `down` and `thread` on each node and builds `wanted`. Nothing in `src/evaluate.ts` or `src/tally.ts` changes.
- Tests in a new file, `test/demand.test.ts`.

## Not in this spec

- Weighting demand by `ratings`, so that some people's 👍 counts for more.
- Demand from outside GitHub, and paid priorities.
- Sorting the whole tree by demand.
